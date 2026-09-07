import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

/**
 * Chapters are keyed on media, and its accepted media types are NOT the SDK's
 * exported `MediaType` (which is video|audio|image). Keep this union local and
 * validate the flag, so a typo fails with a usable message instead of a 4xx.
 */
type ChapterMediaType = "video" | "audio" | "stream";
const CHAPTER_MEDIA_TYPES: ChapterMediaType[] = ["video", "audio", "stream"];

function toMediaType(value: string): ChapterMediaType {
  if (!(CHAPTER_MEDIA_TYPES as string[]).includes(value)) {
    throw new Error(
      `Invalid --media-type "${value}". Expected one of: ${CHAPTER_MEDIA_TYPES.join(", ")}.`,
    );
  }
  return value as ChapterMediaType;
}

export function registerChaptersCommands(program: Command): void {
  const chapters = program.command("chapters").description("Chapter detection and management");

  chapters
    .command("detect")
    .description("Auto-detect chapters in a media item")
    .requiredOption("--media-id <mediaId>", "Media ID")
    .option("--media-type <mediaType>", "Media type (video, audio, stream)", "video")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.chapters.generate({
          media_id: opts.mediaId,
          media_type: toMediaType(opts.mediaType),
        });
        console.log(chalk.green("Chapter detection started."));
        formatOutput(result, program.opts());
      }),
    );

  chapters
    .command("create")
    .description("Add a chapter to an existing chapter set")
    .requiredOption("--set-id <setId>", "Chapter set ID")
    .requiredOption("--title <title>", "Chapter title")
    .requiredOption("--start-time <seconds>", "Chapter start time in seconds")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.chapters.addChapter(opts.setId, {
          title: opts.title,
          start_time: parseFloat(opts.startTime),
        });
        console.log(chalk.green(`Chapter created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  chapters
    .command("list")
    .description("List chapter sets for a media item")
    .requiredOption("--media-id <mediaId>", "Media ID")
    .option("--media-type <mediaType>", "Media type (video, audio, stream)", "video")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.chapters.listSets({
          media_id: opts.mediaId,
          media_type: toMediaType(opts.mediaType),
        });
        formatOutput(result.data, program.opts());
      }),
    );
}
