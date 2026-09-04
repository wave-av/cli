import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/output/index.js";

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
        const result = await client.signage.displays.list({
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
        const result = await client.signage.displays.register({
          name: opts.name,
          location: opts.location,
        });
        console.log(chalk.green(`Display registered: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  const content = signage.command("content").description("Manage signage content");

  content
    .command("upload")
    .description("Upload content for signage")
    .requiredOption("--file <path>", "Path to content file")
    .option("--name <name>", "Content name")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.signage.content.upload({
          file: opts.file,
          name: opts.name,
        });
        console.log(chalk.green(`Content uploaded: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  content
    .command("list")
    .description("List signage content")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.signage.content.list({
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  content
    .command("delete <id>")
    .description("Delete signage content")
    .action(
      wrapCommand(async (id: string) => {
        const confirmed = await confirmDestructive("delete", `content ${id}`, program.opts());
        if (!confirmed) return;
        const client = await getClient(program.opts());
        await client.signage.content.delete(id);
        console.log(chalk.green(`Content ${id} deleted.`));
      }),
    );

  const schedule = signage.command("schedule").description("Manage content schedules");

  schedule
    .command("create")
    .description("Create a content schedule")
    .requiredOption("--display-id <displayId>", "Target display ID")
    .requiredOption("--content-id <contentId>", "Content ID to schedule")
    .option("--start <datetime>", "Start datetime (ISO 8601)")
    .option("--end <datetime>", "End datetime (ISO 8601)")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.signage.schedules.create({
          displayId: opts.displayId,
          contentId: opts.contentId,
          start: opts.start,
          end: opts.end,
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
        const result = await client.signage.schedules.list({
          displayId: opts.displayId,
        });
        formatOutput(result.data, program.opts());
      }),
    );
}
