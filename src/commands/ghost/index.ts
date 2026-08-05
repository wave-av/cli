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
        const result = await client.ghost.suggestions({
          productionId: opts.productionId,
        });
        formatOutput(result, program.opts());
      }),
    );

  ghost
    .command("apply <id>")
    .description("Apply an autopilot suggestion")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.ghost.apply(id);
        console.log(chalk.green(`Suggestion ${id} applied.`));
        formatOutput(result, program.opts());
      }),
    );

  ghost
    .command("history")
    .description("View autopilot action history")
    .option("--production-id <productionId>", "Filter by production ID")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.ghost.history({
          productionId: opts.productionId,
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );
}
