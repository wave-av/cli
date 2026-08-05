import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerMarketplaceCommands(program: Command): void {
  const marketplace = program
    .command("marketplace")
    .description("WAVE marketplace for plugins and extensions");

  marketplace
    .command("search")
    .description("Search the marketplace")
    .requiredOption("--q <query>", "Search query")
    .option("--category <category>", "Filter by category")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.marketplace.search({
          q: opts.q,
          category: opts.category,
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  marketplace
    .command("install <id>")
    .description("Install a marketplace extension")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.marketplace.install(id);
        console.log(chalk.green(`Extension ${id} installed.`));
        formatOutput(result, program.opts());
      }),
    );

  marketplace
    .command("publish")
    .description("Publish an extension to the marketplace")
    .option("--path <path>", "Path to extension package", ".")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.marketplace.publish({ path: opts.path });
        console.log(chalk.green("Extension published successfully."));
        formatOutput(result, program.opts());
      }),
    );

  marketplace
    .command("list")
    .description("List installed extensions")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.marketplace.list();
        formatOutput(result.data, program.opts());
      }),
    );
}
