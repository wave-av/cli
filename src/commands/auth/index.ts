import { Command } from "commander";
import chalk from "chalk";
import { WaveError } from "@wave-av/sdk";
import { AuthRequiredError, wrapCommand } from "../../lib/errors.js";
import { EXIT_CODES } from "../../lib/exit-codes.js";
import { gatewayFetch } from "../../lib/gateway.js";
import { sanitizeForTerminal } from "../../lib/terminal.js";
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
 *
 * The cached organization is dropped: the new credential may belong to another organization, and
 * a stale x-organization-id would send it the old one. The gateway resolves the org from the key;
 * `wave link` records it again.
 */
async function saveProjectEntry(project: string, baseUrl: string, tokenExpiresAt?: number): Promise<void> {
  await updateConfig((config) => {
    const { organizationId: _staleOrgId, organizationName: _staleOrgName, ...kept } =
      config.projects[project] ?? {};
    return {
      ...config,
      currentProject: project,
      projects: {
        ...config.projects,
        [project]: { ...kept, baseUrl, tokenExpiresAt },
      },
    };
  });
}

/**
 * Read an API key piped on stdin (`--api-key-stdin`), like `gh auth login --with-token` and
 * `docker login --password-stdin`. A key passed as `--api-key <key>` is visible to every local
 * user in the process list and lands in shell history; a piped one is neither.
 */
export async function readApiKeyFromStdin(stream: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin): Promise<string> {
  if (stream.isTTY) {
    throw new Error(
      "--api-key-stdin reads the key from a pipe, e.g. " +
        "`printf '%s' \"$WAVE_KEY\" | wave auth login --api-key-stdin`.",
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  const key = Buffer.concat(chunks).toString("utf-8").trim();
  if (!key) throw new Error("--api-key-stdin: stdin was empty. Pipe the API key into the command.");
  if (/\s/.test(key)) throw new Error("--api-key-stdin: expected a single API key on stdin.");
  return key;
}

/** Shared by `wave auth login` and its top-level alias `wave login`. */
function configureLogin(cmd: Command, program: Command): Command {
  return cmd
    .option("--api-key <key>", "API key for non-interactive authentication (prefer --api-key-stdin)")
    .option("--api-key-stdin", "Read the API key from stdin (keeps it out of argv and shell history)")
    .option("--no-browser", "Print the verification URL instead of opening a browser")
    .action(
      wrapCommand(async (opts: { apiKey?: string; apiKeyStdin?: boolean; browser: boolean }) => {
        if (opts.apiKey && opts.apiKeyStdin) {
          throw new Error("Pass the key with --api-key or --api-key-stdin, not both.");
        }
        const config = await loadConfig();
        const project = resolveProjectName(config, program.opts().project);
        const baseUrl = resolveBaseUrl(config, project);
        const apiKey = opts.apiKeyStdin ? await readApiKeyFromStdin() : opts.apiKey;

        if (apiKey) {
          await storeApiKey(project, apiKey);
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
        const creds = await resolveCredentials({ project: program.opts().project, org: program.opts().org });
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

        // Unauthenticated is a real failure for scripts/agents parsing this command's exit code:
        // the documented AUTH_REQUIRED code (2), the same one every other command uses for it.
        if (!authenticated) {
          process.exitCode = EXIT_CODES.AUTH_REQUIRED;
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
        const creds = await resolveCredentials({ project: program.opts().project, org: program.opts().org });
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

        // Every value below except the key source came from the API: strip terminal controls.
        const t = sanitizeForTerminal;
        console.log(chalk.bold("\n  Authenticated as:"));
        if (identity.name !== "N/A") console.log(`  Name:  ${chalk.cyan(t(identity.name))}`);
        if (identity.email !== "N/A") console.log(`  Email: ${chalk.cyan(t(identity.email))}`);
        console.log(`  Org:   ${chalk.cyan(t(identity.organization))}`);
        console.log(`  Project: ${chalk.cyan(t(identity.project))}`);
        console.log(
          `  Key source: ${chalk.cyan(identity.source === "env" ? "WAVE_API_KEY" : "stored credential")}`,
        );
        if (identity.profileUnavailable) {
          console.log(chalk.yellow(`  Profile unavailable: ${t(identity.profileUnavailable)}`));
        }
        if (identity.organizationUnavailable) {
          console.log(chalk.yellow(`  Organization unknown: ${t(identity.organizationUnavailable)}`));
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
  /** Set when neither /v1/me nor /v1/billing would say which organization the key acts for. */
  organizationUnavailable?: string;
}

/**
 * Who does this key act for? GET /v1/me on the API host (1.0.10 called /api/v1/me, which the
 * gateway answers 404 ROUTE_NOT_FOUND). A 403 means the key authenticated but lacks `me:read`; the
 * organization then comes from GET /v1/billing, so whoami still answers "which org".
 *
 * Only a 403 from that fallback (no `billing:read` either) is tolerated, and it is reported as
 * `organizationUnavailable` rather than hidden behind "N/A". A 401, a 5xx or a network failure on
 * either call propagates as an error (structured under -o json, exit 2 for 401): an outage must
 * not look like a successful identity.
 */
export async function lookupIdentity(creds: ResolvedCredentials, config: WaveConfig): Promise<Identity> {
  type Me = { email?: string; name?: string; organization?: string; organizationId?: string };
  let user: Me = {};
  let profileUnavailable: string | undefined;
  let organizationUnavailable: string | undefined;
  // The key's own organization: the saved one is only a cache, and --org is a request, not an answer.
  let organizationId: string | undefined;

  try {
    user = (await gatewayFetch<Me>("/v1/me", { credentials: creds })) ?? {};
    organizationId = user.organizationId;
  } catch (err) {
    if (!(err instanceof WaveError) || err.statusCode !== 403) throw err;
    profileUnavailable = err.message || "profile requires scope me:read";
    try {
      const billing = await gatewayFetch<{ organizationId?: string }>("/v1/billing", { credentials: creds });
      organizationId = billing?.organizationId;
    } catch (billingErr) {
      if (!(billingErr instanceof WaveError) || billingErr.statusCode !== 403) throw billingErr;
      organizationUnavailable =
        `this key can read neither GET /v1/me (me:read) nor GET /v1/billing (billing:read): ` +
        (billingErr.message || "forbidden");
    }
  }

  if (!organizationId && !organizationUnavailable) {
    organizationUnavailable = "the API response did not name an organization";
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
    ...(organizationUnavailable ? { organizationUnavailable } : {}),
  };
}
