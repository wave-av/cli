import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/output/index.js";

export function registerConnectCommands(program: Command): void {
  const connect = program.command("connect").description("Third-party integrations and connectors");

  connect
    .command("integrations")
    .description("List available integrations")
    .option("--limit <n>", "Maximum results", "50")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.connect.integrations({
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  connect
    .command("configure <id>")
    .description("Configure an integration")
    .option("--settings <json>", "JSON settings for the integration")
    .action(
      wrapCommand(async (id: string, opts) => {
        const client = await getClient(program.opts());
        const settings = opts.settings ? JSON.parse(opts.settings as string) : undefined;
        const result = await client.connect.configure(id, { settings });
        console.log(chalk.green(`Integration ${id} configured.`));
        formatOutput(result, program.opts());
      }),
    );

  connect
    .command("status <id>")
    .description("Get integration connection status")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.connect.status(id);
        formatOutput(result, program.opts());
      }),
    );

  connect
    .command("disconnect <id>")
    .description("Disconnect an integration")
    .action(
      wrapCommand(async (id: string) => {
        const confirmed = await confirmDestructive(
          "disconnect",
          `integration ${id}`,
          program.opts(),
        );
        if (!confirmed) return;
        const client = await getClient(program.opts());
        await client.connect.disconnect(id);
        console.log(chalk.green(`Integration ${id} disconnected.`));
      }),
    );
}
