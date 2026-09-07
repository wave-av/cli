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
        // search takes the query as a positional argument, filters as options.
        const result = await client.marketplace.search(opts.q, {
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
    .requiredOption("--name <name>", "Extension name")
    .requiredOption("--description <description>", "Extension description")
    .requiredOption("--type <type>", "Item type")
    .requiredOption("--category <category>", "Marketplace category")
    .requiredOption("--file-url <url>", "URL of the published package artifact")
    .option("--price-cents <cents>", "Price in cents")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // The API publishes from an uploaded artifact URL, not from a local path.
        const result = await client.marketplace.publish({
          name: opts.name,
          description: opts.description,
          type: opts.type,
          category: opts.category,
          file_url: opts.fileUrl,
          price_cents: opts.priceCents ? parseInt(opts.priceCents) : undefined,
        });
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
        // listInstalled, not list: list() enumerates the whole marketplace.
        const result = await client.marketplace.listInstalled();
        formatOutput(result.data, program.opts());
      }),
    );
}
