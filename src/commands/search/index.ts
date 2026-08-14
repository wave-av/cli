import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerSearchCommands(program: Command): void {
  const search = program
    .command("search")
    .description("Content search across streams and recordings");

  search
    .command("query")
    .description("Search content by text query")
    .requiredOption("--q <query>", "Search query")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.search.query({
          q: opts.q,
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  search
    .command("visual")
    .description("Search by visual content")
    .requiredOption("--q <query>", "Visual search query")
    .option("--limit <n>", "Maximum results", "10")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.search.visual({
          q: opts.q,
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  search
    .command("audio")
    .description("Search by audio content")
    .requiredOption("--q <query>", "Audio search query")
    .option("--limit <n>", "Maximum results", "10")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.search.audio({
          q: opts.q,
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  search
    .command("index")
    .description("Index a recording for search")
    .requiredOption("--recording-id <recordingId>", "Recording ID to index")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.search.index({
          recordingId: opts.recordingId,
        });
        console.log(chalk.green("Recording indexing started."));
        formatOutput(result, program.opts());
      }),
    );
}
