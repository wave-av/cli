import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { oneOf } from "../../lib/options.js";
import { confirmDestructive } from "../../lib/output/index.js";

export function registerZoomCommands(program: Command): void {
  // CLI-4267 mutation-proof: deliberate type error, seeded on purpose to prove the new
  // Type-check CI gate actually goes red. This line is removed in the next commit.
  const _deliberateTypeError: number = "this is a string, not a number";
  const zoom = program.command("zoom").description("Zoom meeting and recording integration");

  const meeting = zoom.command("meeting").description("Manage Zoom meetings");

  meeting
    .command("create")
    .description("Create a Zoom meeting")
    .requiredOption("--topic <topic>", "Meeting topic")
    .option("--duration <minutes>", "Duration in minutes", "60")
    .option("--type <type>", "Meeting type (instant, scheduled, recurring)")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.zoom.createMeeting({
          topic: opts.topic,
          duration_minutes: parseInt(opts.duration),
          type: opts.type
            ? oneOf("--type", opts.type, ["instant", "scheduled", "recurring"])
            : undefined,
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
        const client = await getClient(program.opts());
        const result = await client.zoom.listMeetings({
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
        const client = await getClient(program.opts());
        const result = await client.zoom.getMeeting(id);
        formatOutput(result, program.opts());
      }),
    );

  meeting
    .command("end <id>")
    .description("End a Zoom meeting")
    .action(
      wrapCommand(async (id: string) => {
        const confirmed = await confirmDestructive("end", `Zoom meeting ${id}`, program.opts());
        if (!confirmed) return;
        const client = await getClient(program.opts());
        // The API ends a meeting; it does not delete one.
        await client.zoom.endMeeting(id);
        console.log(chalk.green(`Meeting ${id} ended.`));
      }),
    );

  // Recordings subcommands
  const recordings = zoom.command("recordings").description("Manage Zoom recordings");

  recordings
    .command("list")
    .description("List Zoom recordings")
    .option("--meeting-id <meetingId>", "Filter by meeting ID")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.zoom.listRecordings(opts.meetingId, {
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
        const client = await getClient(program.opts());
        const result = await client.zoom.getRecording(id);
        formatOutput(result, program.opts());
      }),
    );

  // Real-Time Media Streams
  const rtms = zoom.command("rtms").description("Manage Zoom RTMS streaming");

  rtms
    .command("start <meetingId>")
    .description("Start streaming a Zoom meeting to an RTMP target")
    .requiredOption("--stream-url <url>", "RTMP ingest URL")
    .requiredOption("--stream-key <key>", "RTMP stream key")
    .action(
      wrapCommand(async (meetingId: string, opts) => {
        const client = await getClient(program.opts());
        const result = await client.zoom.startRTMS(meetingId, {
          stream_url: opts.streamUrl,
          stream_key: opts.streamKey,
        });
        console.log(chalk.green(`RTMS started for meeting ${meetingId}.`));
        formatOutput(result, program.opts());
      }),
    );

  rtms
    .command("stop <meetingId>")
    .description("Stop RTMS streaming for a Zoom meeting")
    .action(
      wrapCommand(async (meetingId: string) => {
        const client = await getClient(program.opts());
        const result = await client.zoom.stopRTMS(meetingId);
        console.log(chalk.green(`RTMS stopped for meeting ${meetingId}.`));
        formatOutput(result, program.opts());
      }),
    );

  rtms
    .command("status <meetingId>")
    .description("Get RTMS status for a Zoom meeting")
    .action(
      wrapCommand(async (meetingId: string) => {
        const client = await getClient(program.opts());
        const result = await client.zoom.getRTMSStatus(meetingId);
        formatOutput(result, program.opts());
      }),
    );

  // Zoom Rooms
  const rooms = zoom.command("rooms").description("Manage Zoom Rooms");

  rooms
    .command("list")
    .description("List Zoom Rooms")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.zoom.listRooms({ limit: parseInt(opts.limit) });
        formatOutput(result.data, program.opts());
      }),
    );

  rooms
    .command("status <roomId>")
    .description("Get Zoom Room status")
    .action(
      wrapCommand(async (roomId: string) => {
        const client = await getClient(program.opts());
        const result = await client.zoom.getRoomStatus(roomId);
        formatOutput(result, program.opts());
      }),
    );
}
