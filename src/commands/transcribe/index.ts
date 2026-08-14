import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerTranscribeCommands(program: Command): void {
  const transcribe = program.command("transcribe").description("Transcription services");

  transcribe
    .command("create")
    .description("Start a transcription job")
    .requiredOption("--stream-id <streamId>", "Stream or recording ID")
    .option("--language <lang>", "Source language", "en")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.transcribe.create({
          streamId: opts.streamId,
          language: opts.language,
        });
        console.log(chalk.green(`Transcription started: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  transcribe
    .command("get <id>")
    .description("Get transcription status and results")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.transcribe.get(id);
        formatOutput(result, program.opts());
      }),
    );

  transcribe
    .command("export <id>")
    .description("Export a transcription")
    .option("--format <format>", "Export format (srt, vtt, txt, json)", "srt")
    .action(
      wrapCommand(async (id: string, opts) => {
        const client = await getClient(program.opts());
        const result = await client.transcribe.export(id, {
          format: opts.format,
        });
        console.log(chalk.green(`Transcription exported as ${opts.format}.`));
        formatOutput(result, program.opts());
      }),
    );
}
