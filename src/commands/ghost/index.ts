import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerGhostCommands(program: Command): void {
  const ghost = program.command("ghost").description("WAVE Autopilot AI director");

  ghost
    .command("suggestions")
    .description("Get AI production suggestions")
    .requiredOption("--production-id <productionId>", "Production ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.ghost.listSuggestions(opts.productionId);
        formatOutput(result.data, program.opts());
      }),
    );

  ghost
    .command("apply <id>")
    .description("Accept an autopilot suggestion")
    .requiredOption("--production-id <productionId>", "Production ID")
    .action(
      wrapCommand(async (id: string, opts) => {
        const client = await getClient(program.opts());
        // Suggestions are scoped to their production.
        const result = await client.ghost.acceptSuggestion(opts.productionId, id);
        console.log(chalk.green(`Suggestion ${id} applied.`));
        formatOutput(result, program.opts());
      }),
    );

  ghost
    .command("history")
    .description("View autopilot action history")
    .requiredOption("--production-id <productionId>", "Production ID")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // GhostAPI has no separate action-history route; listSuggestions
        // already returns each suggestion's outcome (pending/accepted/
        // rejected/expired), which is the autopilot's action log.
        const result = await client.ghost.listSuggestions(opts.productionId, {
          limit: parseInt(opts.limit, 10),
        });
        formatOutput(result.data, program.opts());
      }),
    );
}
