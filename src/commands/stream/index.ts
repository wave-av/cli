import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/output/index.js";

export function registerStreamCommands(program: Command): void {
  const stream = program.command("stream").description("Manage live streams");

  stream
    .command("create")
    .description("Create a new live stream")
    .requiredOption("--title <title>", "Stream title")
    .option("--protocol <protocol>", "Streaming protocol (webrtc, srt, rtmp)", "webrtc")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.pipeline.create({
          title: opts.title,
          protocol: opts.protocol,
        });
        console.log(chalk.green(`Stream created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  stream
    .command("list")
    .description("List all streams")
    .option("--limit <n>", "Maximum results", "20")
    .option("--status <status>", "Filter by status")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const params: Record<string, unknown> = {
          limit: parseInt(opts.limit),
        };
        if (opts.status) params.status = opts.status;
        const result = await client.pipeline.list(params);
        formatOutput(result.data, program.opts());
      }),
    );

  stream
    .command("get <id>")
    .description("Get stream details")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.pipeline.get(id);
        formatOutput(result, program.opts());
      }),
    );

  stream
    .command("update <id>")
    .description("Update a stream")
    .option("--title <title>", "New stream title")
    .option("--protocol <protocol>", "New streaming protocol")
    .action(
      wrapCommand(async (id: string, opts) => {
        const client = await getClient(program.opts());
        const updates: Record<string, unknown> = {};
        if (opts.title) updates.title = opts.title;
        if (opts.protocol) updates.protocol = opts.protocol;
        const result = await client.pipeline.update(id, updates);
        console.log(chalk.green(`Stream ${id} updated.`));
        formatOutput(result, program.opts());
      }),
    );

  stream
    .command("delete <id>")
    .description("Delete a stream")
    .action(
      wrapCommand(async (id: string) => {
        const confirmed = await confirmDestructive("delete", `stream ${id}`, program.opts());
        if (!confirmed) return;
        const client = await getClient(program.opts());
        await client.pipeline.delete(id);
        console.log(chalk.green(`Stream ${id} deleted.`));
      }),
    );

  stream
    .command("start <id>")
    .description("Start a live stream")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.pipeline.start(id);
        console.log(chalk.green(`Stream ${id} started.`));
        formatOutput(result, program.opts());
      }),
    );

  stream
    .command("stop <id>")
    .description("Stop a live stream")
    .action(
      wrapCommand(async (id: string) => {
        const confirmed = await confirmDestructive("stop", `stream ${id}`, program.opts());
        if (!confirmed) return;
        const client = await getClient(program.opts());
        const result = await client.pipeline.stop(id);
        console.log(chalk.green(`Stream ${id} stopped.`));
        formatOutput(result, program.opts());
      }),
    );

  stream
    .command("restart <id>")
    .description("Restart a live stream")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.pipeline.restart(id);
        console.log(chalk.green(`Stream ${id} restarted.`));
        formatOutput(result, program.opts());
      }),
    );

  stream
    .command("status <id>")
    .description("Get stream status")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.pipeline.status(id);
        formatOutput(result, program.opts());
      }),
    );

  stream
    .command("viewers <id>")
    .description("Get viewer count for a stream")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.pipeline.viewers(id);
        formatOutput(result, program.opts());
      }),
    );

  stream
    .command("metrics <id>")
    .description("Get stream metrics")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.pipeline.metrics(id);
        formatOutput(result, program.opts());
      }),
    );

  stream
    .command("recordings <id>")
    .description("List recordings for a stream")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.pipeline.recordings(id);
        formatOutput(result, program.opts());
      }),
    );
}
