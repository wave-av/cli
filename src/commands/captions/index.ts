import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { optionalOneOf } from "../../lib/options.js";

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
          media_id: opts.streamId,
          media_type: "stream",
          language: opts.language,
        });
        console.log(chalk.green("Caption generation started."));
        formatOutput(result, program.opts());
      }),
    );

  captions
    .command("translate")
    .description("Translate a caption track to another language")
    .requiredOption("--track-id <trackId>", "Caption track ID")
    .requiredOption("--target-language <lang>", "Target language code")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // Translation operates on an existing caption track, not on a stream.
        const result = await client.captions.translate(opts.trackId, {
          target_language: opts.targetLanguage,
        });
        console.log(chalk.green(`Translation to ${opts.targetLanguage} started.`));
        formatOutput(result, program.opts());
      }),
    );

  captions
    .command("burn-in")
    .description("Burn a caption track into its media")
    .requiredOption("--track-id <trackId>", "Caption track ID")
    .option("--format <format>", "Output format (mp4, webm, mov)")
    .option("--quality <quality>", "Output quality (low, medium, high, source)")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // Burn-in is keyed on the caption track; the SDK exposes format/quality,
        // and has no named style presets, so none are advertised here.
        const result = await client.captions.burnIn({
          caption_track_id: opts.trackId,
          format: optionalOneOf("--format", opts.format, ["mp4", "webm", "mov"]),
          quality: optionalOneOf("--quality", opts.quality, [
            "low",
            "medium",
            "high",
            "source",
          ]),
        });
        console.log(chalk.green("Caption burn-in started."));
        formatOutput(result, program.opts());
      }),
    );
}
