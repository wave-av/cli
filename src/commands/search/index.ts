import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { oneOf } from "../../lib/options.js";

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
        const result = await client.search.search({
          query: opts.q,
          limit: parseInt(opts.limit),
        });
        // SearchResponse carries `results`, not a paginated `data` envelope.
        formatOutput(result.results, program.opts());
      }),
    );

  search
    .command("visual")
    .description("Search visually similar content using a reference image")
    .requiredOption("--image-url <url>", "URL of the reference image")
    .option("--limit <n>", "Maximum results", "10")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // Visual search matches against a reference IMAGE; it does not accept a
        // text query.
        const result = await client.search.visualSearch({
          image_url: opts.imageUrl,
          limit: parseInt(opts.limit),
        });
        formatOutput(result.results, program.opts());
      }),
    );

  search
    .command("audio")
    .description("Search audibly similar content using a reference audio file")
    .requiredOption("--audio-url <url>", "URL of the reference audio")
    .option("--limit <n>", "Maximum results", "10")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // Audio search matches against a reference AUDIO file, not a text query.
        const result = await client.search.audioSearch({
          audio_url: opts.audioUrl,
          limit: parseInt(opts.limit),
        });
        formatOutput(result.results, program.opts());
      }),
    );

  search
    .command("index")
    .description("Index a media item for search")
    .requiredOption("--media-id <mediaId>", "Media ID to index")
    .option("--media-type <mediaType>", "Media type (video, audio, clip, stream)", "video")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.search.indexMedia(
          opts.mediaId,
          oneOf("--media-type", opts.mediaType, ["video", "audio", "clip", "stream"]),
        );
        console.log(chalk.green("Media indexing started."));
        formatOutput(result, program.opts());
      }),
    );
}
