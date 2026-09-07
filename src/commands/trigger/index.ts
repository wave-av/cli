import { Command } from "commander";
import chalk from "chalk";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { loadConfig } from "../../lib/config/manager.js";
import { getApiKey } from "../../lib/auth/keychain.js";

export function registerTriggerCommands(program: Command): void {
  program
    .command("trigger <event>")
    .description("Trigger a WAVE event manually")
    .option("--override <pairs...>", "Override event data (key=value pairs)")
    .option("--list", "List available trigger events")
    .action(
      wrapCommand(async (event: string, opts) => {
        const config = await loadConfig();
        const project = config.projects[config.currentProject];
        const baseUrl = project?.baseUrl ?? process.env["WAVE_BASE_URL"] ?? "https://wave.online";
        const apiKey = await getApiKey(config.currentProject);

        if (!apiKey) {
          throw new Error(`No API key found. Run ${chalk.bold("wave login")} to authenticate.`);
        }

        if (opts.list) {
          const res = await fetch(`${baseUrl}/api/cli/trigger`, {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "X-Wave-Source": "cli",
            },
          });
          if (!res.ok) throw new Error(`Failed to list events: ${res.statusText}`);
          const events = await res.json();
          formatOutput(events, program.opts());
          return;
        }

        // Parse overrides
        const overrides: Record<string, string> = {};
        if (opts.override) {
          for (const pair of opts.override as string[]) {
            const [key, ...valueParts] = pair.split("=");
            if (key && valueParts.length > 0) {
              overrides[key] = valueParts.join("=");
            }
          }
        }

        const res = await fetch(`${baseUrl}/api/cli/trigger`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-Wave-Source": "cli",
          },
          body: JSON.stringify({ event, data: overrides }),
        });

        if (!res.ok) {
          const error = (await res.json().catch(() => ({}))) as {
            message?: string;
          };
          throw new Error(error.message ?? `Failed to trigger event: ${res.statusText}`);
        }

        const result = await res.json();
        console.log(chalk.green(`Event "${event}" triggered.`));
        formatOutput(result, program.opts());
      }),
    );
}
