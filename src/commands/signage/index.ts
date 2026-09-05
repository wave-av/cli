import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerSignageCommands(program: Command): void {
  const signage = program.command("signage").description("Digital signage management");

  const displays = signage.command("displays").description("Manage signage displays");

  displays
    .command("list")
    .description("List registered displays")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.signage.listDisplays({
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  displays
    .command("register")
    .description("Register a new display")
    .requiredOption("--name <name>", "Display name")
    .option("--location <location>", "Physical location")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.signage.registerDisplay({
          name: opts.name,
          location: opts.location,
        });
        console.log(chalk.green(`Display registered: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  const content = signage.command("content").description("Manage signage content");

  // The SDK has no standalone content asset store (no content.upload/list/delete)
  // — content only exists as PlaylistItem entries embedded in a playlist, created
  // via `signage playlist create` / `signage playlist update`.
  content
    .command("upload")
    .description("Upload content for signage")
    .requiredOption("--file <path>", "Path to content file")
    .option("--name <name>", "Content name")
    .action(
      wrapCommand(async () => {
        throw new Error(
          "Uploading standalone content is not supported by the current SDK. Add items directly via `wave signage playlist create`.",
        );
      }),
    );

  content
    .command("list")
    .description("List signage content")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async () => {
        throw new Error(
          "Listing standalone content is not supported by the current SDK. Content lives inside playlists; use `wave signage playlist list`.",
        );
      }),
    );

  content
    .command("delete <id>")
    .description("Delete signage content")
    .action(
      wrapCommand(async () => {
        throw new Error(
          "Deleting standalone content is not supported by the current SDK. Update the owning playlist via `wave signage playlist update` instead.",
        );
      }),
    );

  const schedule = signage.command("schedule").description("Manage content schedules");

  schedule
    .command("create")
    .description("Schedule a playlist onto displays")
    .requiredOption("--display-ids <ids>", "Comma-separated target display IDs")
    .requiredOption("--playlist-id <playlistId>", "Playlist ID to schedule")
    .requiredOption("--start <datetime>", "Start datetime (ISO 8601)")
    .requiredOption("--end <datetime>", "End datetime (ISO 8601)")
    .option("--days <days>", "Comma-separated days of week (0=Sunday)", "0,1,2,3,4,5,6")
    .option("--recurring", "Repeat on the given days", false)
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // Schedules attach a PLAYLIST to one or more displays; there is no
        // per-content scheduling route.
        const result = await client.signage.scheduleContent({
          playlist_id: opts.playlistId,
          display_ids: (opts.displayIds as string)
            .split(",")
            .map((d: string) => d.trim())
            .filter(Boolean),
          start_time: opts.start,
          end_time: opts.end,
          days_of_week: (opts.days as string)
            .split(",")
            .map((d: string) => parseInt(d.trim(), 10)),
          recurring: Boolean(opts.recurring),
        });
        console.log(chalk.green(`Schedule created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  schedule
    .command("list")
    .description("List content schedules")
    .option("--display-id <displayId>", "Filter by display ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // listSchedules returns a plain array, not a paginated envelope.
        const result = await client.signage.listSchedules(opts.displayId);
        formatOutput(result, program.opts());
      }),
    );
}
