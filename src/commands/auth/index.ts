import { Command } from "commander";
import chalk from "chalk";
import { wrapCommand } from "../../lib/errors.js";
import { formatOutput } from "../../lib/output/index.js";
import { storeApiKey, deleteApiKey, deleteAllKeys, getApiKey } from "../../lib/auth/keychain.js";
import { loadConfig, updateConfig } from "../../lib/config/manager.js";
import { startDeviceAuth, pollForToken } from "../../lib/auth/device-flow.js";

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Manage authentication");

  auth
    .command("login")
    .description("Authenticate with the WAVE platform")
    .option("--api-key <key>", "API key for non-interactive authentication")
    .action(
      wrapCommand(async (opts) => {
        if (opts.apiKey) {
          const config = await loadConfig();
          const project = config.currentProject || "default";
          await storeApiKey(project, opts.apiKey);
          console.log(chalk.green(`API key stored for project "${project}".`));
          return;
        }

        // RFC 8628 Device Authorization Flow via the tested device-flow library.
        // The API host (OAuth device endpoints live under it), not the wave.online marketing site.
        const baseUrl = process.env["WAVE_BASE_URL"] ?? "https://api.wave.online";

        const deviceAuth = await startDeviceAuth(baseUrl);
        const token = await pollForToken(
          baseUrl,
          deviceAuth.device_code,
          deviceAuth.interval,
          deviceAuth.expires_in,
        );

        // Store the API key and update config
        const project = "default";
        await storeApiKey(project, token.access_token);
        await updateConfig((config) => ({
          ...config,
          currentProject: project,
        }));

        console.log(chalk.green("\nAuthentication complete. You can now use the WAVE CLI."));
      }),
    );

  auth
    .command("logout")
    .description("Remove stored credentials")
    .option("--all", "Remove credentials for all projects")
    .action(
      wrapCommand(async (opts) => {
        if (opts.all) {
          await deleteAllKeys();
          console.log(chalk.green("All credentials removed."));
        } else {
          const config = await loadConfig();
          await deleteApiKey(config.currentProject);
          console.log(chalk.green(`Credentials removed for project "${config.currentProject}".`));
        }
      }),
    );

  auth
    .command("status")
    .description("Show current authentication status")
    .action(
      wrapCommand(async () => {
        const config = await loadConfig();
        const apiKey = await getApiKey(config.currentProject);
        const authenticated = !!apiKey;
        const status = {
          project: config.currentProject,
          authenticated,
          organization: config.projects[config.currentProject]?.organizationName ?? "N/A",
          organizationId: config.projects[config.currentProject]?.organizationId ?? "N/A",
        };
        formatOutput(status, program.opts());

        // Unauthenticated is a real failure for scripts/agents parsing this command's exit
        // code — this previously always exited 0 regardless of auth state.
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
        const project = config.currentProject || "default";
        const apiKey = await getApiKey(project);

        if (!apiKey) {
          console.error(chalk.red("Not authenticated. Run `wave auth login` first."));
          process.exit(1);
          return;
        }

        // The API host, not the wave.online marketing site.
        const baseUrl = config.projects[project]?.baseUrl ?? "https://api.wave.online";
        const res = await fetch(`${baseUrl}/api/v1/me`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });

        if (!res.ok) {
          console.error(
            chalk.red(
              "Authentication invalid or expired. Run `wave auth login` to re-authenticate.",
            ),
          );
          process.exit(1);
          return;
        }

        const user = (await res.json()) as {
          id?: string;
          email?: string;
          name?: string;
          organization?: string;
        };

        console.log(chalk.bold("\n  Authenticated as:"));
        if (user.name) console.log(`  Name:  ${chalk.cyan(user.name)}`);
        if (user.email) console.log(`  Email: ${chalk.cyan(user.email)}`);
        console.log(
          `  Org:   ${chalk.cyan(user.organization ?? config.projects[project]?.organizationName ?? "N/A")}`,
        );
        console.log(`  Project: ${chalk.cyan(project)}`);
        console.log("");

        formatOutput(
          {
            project,
            name: user.name ?? "N/A",
            email: user.email ?? "N/A",
            organization: user.organization ?? config.projects[project]?.organizationName ?? "N/A",
          },
          program.opts(),
        );
      }),
    );
}
