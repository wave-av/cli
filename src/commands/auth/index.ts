import { Command } from "commander";
import chalk from "chalk";
import { WaveError } from "@wave-av/sdk";
import { AuthRequiredError, wrapCommand } from "../../lib/errors.js";
import { gatewayFetch } from "../../lib/gateway.js";
import type { WaveConfig } from "../../types/index.js";
import { formatOutput } from "../../lib/output/index.js";
import {
  storeApiKey,
  storeRefreshToken,
  deleteApiKey,
  deleteAllKeys,
} from "../../lib/auth/keychain.js";
import { loadConfig, updateConfig } from "../../lib/config/manager.js";
import { startDeviceAuth, pollForToken } from "../../lib/auth/device-flow.js";
import {
  resolveBaseUrl,
  resolveCredentials,
  resolveProjectName,
  type ResolvedCredentials,
} from "../../lib/auth/credentials.js";

/**
 * Persist the project entry `getClient()` and friends read. 1.0.10 stored the key but never wrote
 * `projects[<name>]`, and nothing else could create it without already being authenticated.
 */
async function saveProjectEntry(project: string, baseUrl: string, tokenExpiresAt?: number): Promise<void> {
  await updateConfig((config) => ({
    ...config,
    currentProject: project,
    projects: {
      ...config.projects,
      [project]: { ...config.projects[project], baseUrl, tokenExpiresAt },
    },
  }));
}

/** Shared by `wave auth login` and its top-level alias `wave login`. */
function configureLogin(cmd: Command, program: Command): Command {
  return cmd
    .option("--api-key <key>", "API key for non-interactive authentication")
    .option("--no-browser", "Print the verification URL instead of opening a browser")
    .action(
      wrapCommand(async (opts: { apiKey?: string; browser: boolean }) => {
        const config = await loadConfig();
        const project = resolveProjectName(config, program.opts().project);
        const baseUrl = resolveBaseUrl(config, project);

        if (opts.apiKey) {
          await storeApiKey(project, opts.apiKey);
          await saveProjectEntry(project, baseUrl);
          console.log(chalk.green(`API key stored for project "${project}".`));
          console.log(chalk.gray("  Check it with `wave whoami`."));
          return;
        }

        // RFC 8628 device flow against the API host's /v1/agent/auth ceremony.
        const grant = await startDeviceAuth(baseUrl, { openBrowser: opts.browser });
        const tokens = await pollForToken(baseUrl, grant.device_code, grant.interval, grant.expires_in);

        await storeApiKey(project, tokens.access_token);
        if (tokens.refresh_token) await storeRefreshToken(project, tokens.refresh_token);
        await saveProjectEntry(
          project,
          baseUrl,
          tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
        );

        console.log(chalk.green("\nAuthentication complete. You can now use the WAVE CLI."));
      }),
    );
}

function configureLogout(cmd: Command, program: Command): Command {
  return cmd.option("--all", "Remove credentials for all projects").action(
    wrapCommand(async (opts: { all?: boolean }) => {
      if (opts.all) {
        await deleteAllKeys();
        console.log(chalk.green("All credentials removed."));
        return;
      }
      const config = await loadConfig();
      const project = resolveProjectName(config, program.opts().project);
      await deleteApiKey(project);
      console.log(chalk.green(`Credentials removed for project "${project}".`));
      if (process.env["WAVE_API_KEY"]) {
        console.log(chalk.yellow("  WAVE_API_KEY is still set in this environment and will keep being used."));
      }
    }),
  );
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Manage authentication");

  configureLogin(auth.command("login").description("Authenticate with the WAVE platform"), program);
  configureLogout(auth.command("logout").description("Remove stored credentials"), program);

  // Top-level aliases: the README, `wave doctor`, and years of muscle memory say `wave login`.
  // 1.0.10 answered that with "unknown command 'login' (Did you mean logs?)".
  configureLogin(program.command("login").description("Authenticate (alias for `wave auth login`)"), program);
  configureLogout(program.command("logout").description("Remove stored credentials (alias for `wave auth logout`)"), program);

  auth
    .command("status")
    .description("Show current authentication status")
    .action(
      wrapCommand(async () => {
        const config = await loadConfig();
        const creds = await resolveCredentials({ project: program.opts().project });
        const project = creds?.project ?? resolveProjectName(config, program.opts().project);
        const authenticated = !!creds;
        const status = {
          project,
          authenticated,
          source: creds?.source ?? "none",
          apiEndpoint: creds?.baseUrl ?? resolveBaseUrl(config, project),
          organization: config.projects[project]?.organizationName ?? "N/A",
          organizationId: creds?.organizationId ?? config.projects[project]?.organizationId ?? "N/A",
        };
        formatOutput(status, program.opts());

        // Unauthenticated is a real failure for scripts/agents parsing this command's exit code.
        if (!authenticated) {
          process.exitCode = 1;
        }
      }),
    );

  // Top-level whoami alias
  program
    .command("whoami")
    .description("Show the current authenticated user")
    .action(
      wrapCommand(async () => {
        const config = await loadConfig();
        const creds = await resolveCredentials({ project: program.opts().project });
        if (!creds) {
          // Exit 2 (AUTH_REQUIRED) with the structured envelope under -o json, like every other command.
          throw new AuthRequiredError();
        }

        const identity = await lookupIdentity(creds, config);
        const output = program.opts().output;

        // JSON/YAML get exactly one document on stdout (1.0.10 printed the human block first, so
        // `wave whoami -o json | jq` failed to parse).
        if (output === "json" || output === "yaml") {
          formatOutput(identity, program.opts());
          return;
        }

        console.log(chalk.bold("\n  Authenticated as:"));
        if (identity.name !== "N/A") console.log(`  Name:  ${chalk.cyan(identity.name)}`);
        if (identity.email !== "N/A") console.log(`  Email: ${chalk.cyan(identity.email)}`);
        console.log(`  Org:   ${chalk.cyan(identity.organization)}`);
        console.log(`  Project: ${chalk.cyan(identity.project)}`);
        console.log(
          `  Key source: ${chalk.cyan(identity.source === "env" ? "WAVE_API_KEY" : "stored credential")}`,
        );
        if (identity.profileUnavailable) {
          console.log(chalk.yellow(`  Profile unavailable: ${identity.profileUnavailable}`));
        }
        console.log("");
      }),
    );
}

export interface Identity {
  authenticated: true;
  project: string;
  source: ResolvedCredentials["source"];
  name: string;
  email: string;
  organization: string;
  organizationId: string;
  profileUnavailable?: string;
}

/**
 * Who does this key act for? GET /v1/me on the API host (1.0.10 called /api/v1/me, which the
 * gateway answers 404 ROUTE_NOT_FOUND). A 403 means the key authenticated but lacks `me:read`; the
 * organization then comes from GET /v1/billing, best effort, so whoami still answers "which org".
 * A 401 or any other failure propagates as a WaveError (structured under -o json, exit 2 for 401).
 */
export async function lookupIdentity(creds: ResolvedCredentials, config: WaveConfig): Promise<Identity> {
  type Me = { email?: string; name?: string; organization?: string; organizationId?: string };
  let user: Me = {};
  let profileUnavailable: string | undefined;
  let organizationId = creds.organizationId;

  try {
    user = (await gatewayFetch<Me>("/v1/me", { credentials: creds })) ?? {};
    organizationId = user.organizationId ?? organizationId;
  } catch (err) {
    if (!(err instanceof WaveError) || err.statusCode !== 403) throw err;
    profileUnavailable = err.message || "profile requires scope me:read";
    try {
      const billing = await gatewayFetch<{ organizationId?: string }>("/v1/billing", { credentials: creds });
      organizationId = billing?.organizationId ?? organizationId;
    } catch (billingErr) {
      // Enrichment only: the key already proved it authenticates (403, not 401).
      if (!(billingErr instanceof WaveError)) throw billingErr;
    }
  }

  const organization =
    user.organization ?? config.projects[creds.project]?.organizationName ?? organizationId ?? "N/A";

  return {
    authenticated: true,
    project: creds.project,
    source: creds.source,
    name: user.name ?? "N/A",
    email: user.email ?? "N/A",
    organization,
    organizationId: organizationId ?? "N/A",
    ...(profileUnavailable ? { profileUnavailable } : {}),
  };
}
