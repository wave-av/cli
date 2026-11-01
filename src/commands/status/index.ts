import { Command } from "commander";
import chalk from "chalk";
import { wrapCommand } from "../../lib/errors.js";
import { loadConfig } from "../../lib/config/manager.js";
import {
  resolveBaseUrl,
  resolveCredentials,
  resolveProjectName,
} from "../../lib/auth/credentials.js";
import { formatOutput } from "../../lib/output/index.js";

export function registerStatusCommands(program: Command): void {
  program
    .command("status")
    .description("Show WAVE CLI status (auth, API health, current project)")
    .action(
      wrapCommand(async () => {
        const config = await loadConfig();
        const project = resolveProjectName(config, program.opts().project);
        // WAVE_API_KEY counts as authenticated here too (1.0.10 read only the keychain, so CI
        // users with the env var set were told "Not authenticated").
        const creds = await resolveCredentials({ project });
        // The API endpoint, not the marketing site: WAVE_BASE_URL / config.projects[x].baseUrl /
        // the default must point at the WAVE API (api.wave.online), never wave.online (the
        // marketing site), which doesn't serve /health and would make this check falsely appear
        // healthy on any 200-returning page.
        const baseUrl = resolveBaseUrl(config, project);

        // Check auth status
        const authenticated = !!creds;

        // Check API health
        let apiHealthy = false;
        let apiLatencyMs: number | null = null;
        try {
          const start = Date.now();
          const res = await fetch(`${baseUrl}/health`, {
            signal: AbortSignal.timeout(5000),
          });
          apiLatencyMs = Date.now() - start;
          apiHealthy = res.ok;
        } catch {
          apiHealthy = false;
        }

        const status = {
          project,
          authenticated,
          organization: config.projects[project]?.organizationName ?? "N/A",
          apiEndpoint: baseUrl,
          apiHealthy,
          apiLatencyMs,
        };

        const output = program.opts().output;
        if (output === "json" || output === "yaml") {
          // Exactly one machine-readable document on stdout (1.0.10 printed the human block first,
          // so `wave status -o json | jq` failed to parse).
          formatOutput(status, program.opts());
        } else {
          console.log(chalk.bold("\nWAVE CLI Status\n"));
          console.log(
            `  Auth:     ${authenticated ? chalk.green("Authenticated") : chalk.red("Not authenticated")}`,
          );
          console.log(`  Project:  ${chalk.cyan(project)}`);
          console.log(
            `  Org:      ${chalk.cyan(config.projects[project]?.organizationName ?? "N/A")}`,
          );
          console.log(`  Endpoint: ${chalk.cyan(baseUrl)}`);
          console.log(
            `  API:      ${apiHealthy ? chalk.green(`Healthy (${apiLatencyMs}ms)`) : chalk.red("Unreachable")}`,
          );
          console.log("");

          if (!authenticated) {
            console.log(chalk.yellow("  Run `wave auth login` (or set WAVE_API_KEY) to authenticate.\n"));
          }
        }

        // Not authenticated or the API is unreachable is a real failure for scripts/agents
        // parsing this command's exit code — surface it instead of silently exiting 0.
        if (!authenticated || !apiHealthy) {
          process.exitCode = 1;
        }
      }),
    );
}
