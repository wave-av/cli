import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/output/index.js";

type AnySDK = Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;

export function registerZoomCommands(program: Command): void {
  const zoom = program.command("zoom").description("Zoom meeting and webinar integration");

  const meeting = zoom.command("meeting").description("Manage Zoom meetings");

  meeting
    .command("create")
    .description("Create a Zoom meeting")
    .requiredOption("--topic <topic>", "Meeting topic")
    .option("--duration <minutes>", "Duration in minutes", "60")
    .action(
      wrapCommand(async (opts) => {
        const client = (await getClient(program.opts())) as unknown as AnySDK;
        const result = await client.zoom.meetings.create({
          topic: opts.topic,
          duration: parseInt(opts.duration),
        });
        console.log(chalk.green(`Meeting created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  meeting
    .command("list")
    .description("List Zoom meetings")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = (await getClient(program.opts())) as unknown as AnySDK;
        const result = await client.zoom.meetings.list({
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  meeting
    .command("get <id>")
    .description("Get Zoom meeting details")
    .action(
      wrapCommand(async (id: string) => {
        const client = (await getClient(program.opts())) as unknown as AnySDK;
        const result = await client.zoom.meetings.get(id);
        formatOutput(result, program.opts());
      }),
    );

  meeting
    .command("delete <id>")
    .description("Delete a Zoom meeting")
    .action(
      wrapCommand(async (id: string) => {
        const confirmed = await confirmDestructive("delete", `Zoom meeting ${id}`, program.opts());
        if (!confirmed) return;
        const client = (await getClient(program.opts())) as unknown as AnySDK;
        await client.zoom.meetings.delete(id);
        console.log(chalk.green(`Meeting ${id} deleted.`));
      }),
    );

  // Recordings subcommands
  const recordings = zoom.command("recordings").description("Manage Zoom recordings");

  recordings
    .command("list")
    .description("List Zoom recordings")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = (await getClient(program.opts())) as unknown as AnySDK;
        const result = await client.zoom.recordings.list({
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  recordings
    .command("get <id>")
    .description("Get Zoom recording details")
    .action(
      wrapCommand(async (id: string) => {
        const client = (await getClient(program.opts())) as unknown as AnySDK;
        const result = await client.zoom.recordings.get(id);
        formatOutput(result, program.opts());
      }),
    );

  // Webinar subcommands
  const webinar = zoom.command("webinar").description("Manage Zoom webinars");

  webinar
    .command("create")
    .description("Create a Zoom webinar")
    .requiredOption("--topic <topic>", "Webinar topic")
    .option("--duration <minutes>", "Duration in minutes", "60")
    .action(
      wrapCommand(async (opts) => {
        const client = (await getClient(program.opts())) as unknown as AnySDK;
        const result = await client.zoom.webinars.create({
          topic: opts.topic,
          duration: parseInt(opts.duration),
        });
        console.log(chalk.green(`Webinar created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  webinar
    .command("list")
    .description("List Zoom webinars")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = (await getClient(program.opts())) as unknown as AnySDK;
        const result = await client.zoom.webinars.list({
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );
}
