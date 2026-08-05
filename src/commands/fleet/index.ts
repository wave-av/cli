import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerFleetCommands(program: Command): void {
  const fleet = program.command("fleet").description("Device fleet management");

  fleet
    .command("list")
    .description("List all devices in the fleet")
    .option("--limit <n>", "Maximum results", "20")
    .option("--status <status>", "Filter by device status")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const params: Record<string, unknown> = {
          limit: parseInt(opts.limit),
        };
        if (opts.status) params.status = opts.status;
        const result = await client.fleet.list(params);
        formatOutput(result.data, program.opts());
      }),
    );

  fleet
    .command("get <id>")
    .description("Get device details")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.fleet.get(id);
        formatOutput(result, program.opts());
      }),
    );

  fleet
    .command("command <id>")
    .description("Send a command to a device")
    .requiredOption("--action <action>", "Command action (reboot, update, configure)")
    .option("--payload <json>", "JSON payload for the command")
    .action(
      wrapCommand(async (id: string, opts) => {
        const client = await getClient(program.opts());
        const payload = opts.payload ? JSON.parse(opts.payload as string) : undefined;
        const result = await client.fleet.command(id, {
          action: opts.action,
          payload,
        });
        console.log(chalk.green(`Command sent to device ${id}.`));
        formatOutput(result, program.opts());
      }),
    );

  fleet
    .command("health <id>")
    .description("Get device health status")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.fleet.health(id);
        formatOutput(result, program.opts());
      }),
    );
}
