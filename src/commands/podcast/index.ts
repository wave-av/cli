import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/output/index.js";

export function registerPodcastCommands(program: Command): void {
  const podcast = program.command("podcast").description("Podcast management");

  const episodes = podcast.command("episodes").description("Manage podcast episodes");

  episodes
    .command("create")
    .description("Create a podcast episode")
    .requiredOption("--title <title>", "Episode title")
    .option("--description <desc>", "Episode description")
    .option("--audio <path>", "Path to audio file")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.podcast.episodes.create({
          title: opts.title,
          description: opts.description,
          audioPath: opts.audio,
        });
        console.log(chalk.green(`Episode created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  episodes
    .command("list")
    .description("List podcast episodes")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.podcast.episodes.list({
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
        const result = await client.podcast.episodes.get(id);
        formatOutput(result, program.opts());
      }),
    );

  episodes
    .command("publish <id>")
    .description("Publish a podcast episode")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.podcast.episodes.publish(id);
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
        await client.podcast.episodes.delete(id);
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
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.podcast.rss.get();
        formatOutput(result, program.opts());
      }),
    );

  podcast
    .command("distribute")
    .description("Distribute podcast to platforms")
    .option("--platforms <platforms>", "Comma-separated platforms (spotify, apple, google)")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const platforms = opts.platforms
          ? (opts.platforms as string).split(",").map((p: string) => p.trim())
          : undefined;
        const result = await client.podcast.distribute({ platforms });
        console.log(chalk.green("Distribution initiated."));
        formatOutput(result, program.opts());
      }),
    );
}
