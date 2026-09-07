import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { oneOf } from "../../lib/options.js";

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
          source_type: "stream",
          source_id: opts.streamId,
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
    .option("--format <format>", "Export format (txt, json, srt, vtt, docx, pdf)", "srt")
    .action(
      wrapCommand(async (id: string, opts) => {
        const client = await getClient(program.opts());
        const result = await client.transcribe.exportTranscription(
          id,
          oneOf("--format", opts.format, ["txt", "json", "srt", "vtt", "docx", "pdf"]),
        );
        console.log(chalk.green(`Transcription exported as ${opts.format}.`));
        formatOutput(result, program.opts());
      }),
    );
}
