import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { oneOf } from "../../lib/options.js";

export function registerClipCommands(program: Command): void {
  const clip = program.command("clip").description("Manage stream clips");

  clip
    .command("create")
    .description("Create a clip from a stream")
    .requiredOption("--stream-id <streamId>", "Source stream ID")
    .requiredOption("--start <start>", "Start time in seconds")
    .requiredOption("--end <end>", "End time in seconds")
    .requiredOption("--title <title>", "Clip title")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.clips.create({
          title: opts.title,
          source: {
            type: "stream",
            id: opts.streamId,
            start_time: parseFloat(opts.start),
            end_time: parseFloat(opts.end),
          },
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
    .option("--format <format>", "Export format (mp4, webm, mov, gif, mp3, wav)", "mp4")
    .action(
      wrapCommand(async (id: string, opts) => {
        const client = await getClient(program.opts());
        const result = await client.clips.exportClip(id, {
          format: oneOf("--format", opts.format, ["mp4", "webm", "mov", "gif", "mp3", "wav"]),
        });
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
        // The SDK has no download helper; it surfaces a signed URL on the clip and
        // leaves the transfer to the caller.
        const clip = await client.clips.get(id);
        if (!clip.download_url) {
          throw new Error(
            `Clip ${id} has no download URL yet (status: ${clip.status}). ` +
              `Export it first with "wave clip export ${id}".`,
          );
        }
        const response = await fetch(clip.download_url);
        if (!response.ok) {
          throw new Error(
            `Download failed for clip ${id}: ${response.status} ${response.statusText}`,
          );
        }
        const destination = opts.output ?? `${id}.mp4`;
        await writeFile(destination, Buffer.from(await response.arrayBuffer()));
        console.log(chalk.green(`Clip ${id} downloaded to ${destination}`));
      }),
    );
}
