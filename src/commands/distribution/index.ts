import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/output/index.js";

export function registerDistributionCommands(program: Command): void {
  const distribution = program
    .command("distribution")
    .description("Multi-platform stream distribution");

  distribution
    .command("simulcast")
    .description("Set up simulcast for a stream")
    .requiredOption("--stream-id <streamId>", "Stream ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.distribution.simulcast({
          streamId: opts.streamId,
        });
        console.log(chalk.green("Simulcast configured."));
        formatOutput(result, program.opts());
      }),
    );

  const destinations = distribution
    .command("destinations")
    .description("Manage distribution destinations");

  destinations
    .command("list")
    .description("List distribution destinations")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.distribution.destinations.list();
        formatOutput(result.data, program.opts());
      }),
    );

  destinations
    .command("add")
    .description("Add a distribution destination")
    .requiredOption("--platform <platform>", "Platform (youtube, twitch, facebook, custom)")
    .requiredOption("--stream-key <key>", "Stream key for the platform")
    .option("--url <url>", "Custom RTMP URL")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.distribution.destinations.add({
          platform: opts.platform,
          streamKey: opts.streamKey,
          url: opts.url,
        });
        console.log(chalk.green(`Destination added: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  destinations
    .command("remove <id>")
    .description("Remove a distribution destination")
    .action(
      wrapCommand(async (id: string) => {
        const confirmed = await confirmDestructive("remove", `destination ${id}`, program.opts());
        if (!confirmed) return;
        const client = await getClient(program.opts());
        await client.distribution.destinations.remove(id);
        console.log(chalk.green(`Destination ${id} removed.`));
      }),
    );
}
