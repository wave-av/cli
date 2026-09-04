import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { oneOf } from "../../lib/options.js";
import { confirmDestructive } from "../../lib/output/index.js";

export function registerPodcastCommands(program: Command): void {
  const podcast = program.command("podcast").description("Podcast management");

  const episodes = podcast.command("episodes").description("Manage podcast episodes");

  episodes
    .command("create")
    .description("Create a podcast episode")
    .requiredOption("--podcast-id <podcastId>", "Podcast ID")
    .requiredOption("--title <title>", "Episode title")
    .requiredOption("--description <desc>", "Episode description")
    .option("--audio-url <url>", "Publicly reachable URL of the episode audio")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // The API ingests audio by URL; it does not accept a local file path.
        const result = await client.podcast.createEpisode({
          podcast_id: opts.podcastId,
          title: opts.title,
          description: opts.description,
          audio_url: opts.audioUrl,
        });
        console.log(chalk.green(`Episode created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  episodes
    .command("list")
    .description("List podcast episodes")
    .requiredOption("--podcast-id <podcastId>", "Podcast ID")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.podcast.listEpisodes(opts.podcastId, {
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  episodes
    .command("get <id>")
    .description("Get episode details")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.podcast.getEpisode(id);
        formatOutput(result, program.opts());
      }),
    );

  episodes
    .command("publish <id>")
    .description("Publish a podcast episode")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.podcast.publishEpisode(id);
        console.log(chalk.green(`Episode ${id} published.`));
        formatOutput(result, program.opts());
      }),
    );

  episodes
    .command("delete <id>")
    .description("Delete a podcast episode")
    .action(
      wrapCommand(async (id: string) => {
        const confirmed = await confirmDestructive("delete", `episode ${id}`, program.opts());
        if (!confirmed) return;
        const client = await getClient(program.opts());
        await client.podcast.removeEpisode(id);
        console.log(chalk.green(`Episode ${id} deleted.`));
      }),
    );

  // RSS
  const rss = podcast.command("rss").description("Manage podcast RSS feed");

  rss
    .command("generate")
    .description("Generate an RSS feed")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.podcast.rss.generate();
        console.log(chalk.green("RSS feed generated."));
        formatOutput(result, program.opts());
      }),
    );

  rss
    .command("get")
    .description("Get the current RSS feed URL")
    .requiredOption("--podcast-id <podcastId>", "Podcast ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.podcast.getRSSFeed(opts.podcastId);
        formatOutput(result, program.opts());
      }),
    );

  podcast
    .command("distribute")
    .description("Distribute podcast to platforms")
    .requiredOption("--podcast-id <podcastId>", "Podcast ID")
    .requiredOption(
      "--platforms <platforms>",
      "Comma-separated platforms (spotify, apple, google, amazon, overcast)",
    )
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const platforms = (opts.platforms as string)
          .split(",")
          .map((p: string) => p.trim())
          .filter(Boolean)
          .map((p: string) =>
            oneOf("--platforms", p, ["spotify", "apple", "google", "amazon", "overcast"]),
          );
        const result = await client.podcast.distribute(opts.podcastId, platforms);
        console.log(chalk.green("Distribution initiated."));
        formatOutput(result, program.opts());
      }),
    );
}
