import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerCaptionsCommands(program: Command): void {
  const captions = program.command("captions").description("Live captioning and subtitles");

  captions
    .command("generate")
    .description("Generate captions for a stream")
    .requiredOption("--stream-id <streamId>", "Stream ID")
    .option("--language <lang>", "Source language", "en")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.captions.generate({
          streamId: opts.streamId,
          language: opts.language,
        });
        console.log(chalk.green("Caption generation started."));
        formatOutput(result, program.opts());
      }),
    );

  captions
    .command("translate")
    .description("Translate captions to another language")
    .requiredOption("--stream-id <streamId>", "Stream ID")
    .requiredOption("--target-language <lang>", "Target language code")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.captions.translate({
          streamId: opts.streamId,
          targetLanguage: opts.targetLanguage,
        });
        console.log(chalk.green(`Translation to ${opts.targetLanguage} started.`));
        formatOutput(result, program.opts());
      }),
    );

  captions
    .command("burn-in")
    .description("Burn captions into a recording")
    .requiredOption("--recording-id <recordingId>", "Recording ID")
    .option("--style <style>", "Caption style (default, cinematic, minimal)", "default")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.captions.burnIn({
          recordingId: opts.recordingId,
          style: opts.style,
        });
        console.log(chalk.green("Caption burn-in started."));
        formatOutput(result, program.opts());
      }),
    );
}
