import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerClipCommands(program: Command): void {
  const clip = program.command("clip").description("Manage stream clips");

  clip
    .command("create")
    .description("Create a clip from a stream")
    .requiredOption("--stream-id <streamId>", "Source stream ID")
    .requiredOption("--start <start>", "Start time in seconds")
    .requiredOption("--end <end>", "End time in seconds")
    .option("--title <title>", "Clip title")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.clips.create({
          streamId: opts.streamId,
          start: parseFloat(opts.start),
          end: parseFloat(opts.end),
          title: opts.title,
        });
        console.log(chalk.green(`Clip created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  clip
    .command("list")
    .description("List all clips")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.clips.list({ limit: parseInt(opts.limit) });
        formatOutput(result.data, program.opts());
      }),
    );

  clip
    .command("get <id>")
    .description("Get clip details")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.clips.get(id);
        formatOutput(result, program.opts());
      }),
    );

  clip
    .command("export <id>")
    .description("Export a clip")
    .option("--format <format>", "Export format (mp4, webm, gif)", "mp4")
    .action(
      wrapCommand(async (id: string, opts) => {
        const client = await getClient(program.opts());
        const result = await client.clips.export(id, { format: opts.format });
        console.log(chalk.green(`Clip ${id} export started.`));
        formatOutput(result, program.opts());
      }),
    );

  clip
    .command("download <id>")
    .description("Download a clip to local filesystem")
    .option("--output <path>", "Output file path")
    .action(
      wrapCommand(async (id: string, opts) => {
        const client = await getClient(program.opts());
        const result = await client.clips.download(id, { output: opts.output });
        console.log(chalk.green(`Clip ${id} downloaded to ${result.path}`));
      }),
    );
}
