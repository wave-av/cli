import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { oneOf } from "../../lib/options.js";
import { confirmDestructive } from "../../lib/output/index.js";

export function registerDistributionCommands(program: Command): void {
  const distribution = program
    .command("distribution")
    .description("Multi-platform stream distribution");

  distribution
    .command("simulcast")
    .description("Start simulcasting a stream to configured destinations")
    .requiredOption("--stream-id <streamId>", "Stream ID")
    .requiredOption(
      "--destinations <ids>",
      "Comma-separated destination IDs to simulcast to",
    )
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const destinationIds = (opts.destinations as string)
          .split(",")
          .map((d: string) => d.trim())
          .filter(Boolean);
        const result = await client.distribution.startSimulcast(opts.streamId, destinationIds);
        console.log(chalk.green("Simulcast started."));
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
        const result = await client.distribution.listDestinations();
        formatOutput(result.data, program.opts());
      }),
    );

  destinations
    .command("add")
    .description("Add a distribution destination")
    .requiredOption("--name <name>", "Human-readable destination name")
    .requiredOption(
      "--platform <platform>",
      "Platform (youtube, twitch, facebook, linkedin, twitter, tiktok, instagram, custom_rtmp)",
    )
    .option(
      "--stream-key-ref <ref>",
      "Reference to the stored stream-key credential (not the key itself)",
    )
    .option("--url <url>", "Custom RTMP URL")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // The API stores a REFERENCE to the platform stream key, never the key
        // itself, so the CLI must not accept a raw secret on argv either.
        const result = await client.distribution.addDestination({
          name: opts.name,
          type: oneOf("--platform", opts.platform, [
            "youtube",
            "twitch",
            "facebook",
            "linkedin",
            "twitter",
            "tiktok",
            "instagram",
            "custom_rtmp",
          ]),
          stream_key_ref: opts.streamKeyRef,
          rtmp_url: opts.url,
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
        await client.distribution.removeDestination(id);
        console.log(chalk.green(`Destination ${id} removed.`));
      }),
    );
}
