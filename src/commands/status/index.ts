import { Command } from "commander";
import chalk from "chalk";
import { wrapCommand } from "../../lib/errors.js";
import { getApiKey } from "../../lib/auth/keychain.js";
import { loadConfig } from "../../lib/config/manager.js";
import { formatOutput } from "../../lib/output/index.js";

export function registerStatusCommands(program: Command): void {
  program
    .command("status")
    .description("Show WAVE CLI status (auth, API health, current project)")
    .action(
      wrapCommand(async () => {
        const config = await loadConfig();
        const project = config.currentProject || "default";
        const apiKey = await getApiKey(project);
        const baseUrl = config.projects[project]?.baseUrl ?? "https://wave.online";

        // Check auth status
        const authenticated = !!apiKey;

        // Check API health
        let apiHealthy = false;
        let apiLatencyMs: number | null = null;
        try {
          const start = Date.now();
          const res = await fetch(`${baseUrl}/api/health`, {
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

        // Interactive display
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
          console.log(chalk.yellow("  Run `wave auth login` to authenticate.\n"));
        }

        // Machine-readable output (--output json/yaml)
        formatOutput(status, program.opts());
      }),
    );
}
