import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerDesktopCommands(program: Command): void {
  const desktop = program.command("desktop").description("Desktop node management and pairing");

  desktop
    .command("nodes")
    .description("List connected desktop nodes")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.desktop.nodes();
        formatOutput(result.data, program.opts());
      }),
    );

  desktop
    .command("pair")
    .description("Pair a desktop node")
    .requiredOption("--code <code>", "Pairing code from the desktop application")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.desktop.pair({ code: opts.code });
        console.log(chalk.green("Desktop node paired successfully."));
        formatOutput(result, program.opts());
      }),
    );

  desktop
    .command("status <id>")
    .description("Get desktop node status")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.desktop.getStatus(id);
        formatOutput(result, program.opts());
      }),
    );
}
