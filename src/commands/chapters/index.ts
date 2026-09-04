import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerChaptersCommands(program: Command): void {
  const chapters = program.command("chapters").description("Chapter detection and management");

  chapters
    .command("detect")
    .description("Auto-detect chapters in a recording")
    .requiredOption("--recording-id <recordingId>", "Recording ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.chapters.detect({
          recordingId: opts.recordingId,
        });
        console.log(chalk.green("Chapter detection started."));
        formatOutput(result, program.opts());
      }),
    );

  chapters
    .command("create")
    .description("Create a chapter manually")
    .requiredOption("--recording-id <recordingId>", "Recording ID")
    .requiredOption("--title <title>", "Chapter title")
    .requiredOption("--timestamp <timestamp>", "Timestamp in seconds")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.chapters.create({
          recordingId: opts.recordingId,
          title: opts.title,
          timestamp: parseFloat(opts.timestamp),
        });
        console.log(chalk.green(`Chapter created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  chapters
    .command("list")
    .description("List chapters for a recording")
    .requiredOption("--recording-id <recordingId>", "Recording ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.chapters.list({
          recordingId: opts.recordingId,
        });
        formatOutput(result.data, program.opts());
      }),
    );
}
