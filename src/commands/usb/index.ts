import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerUsbCommands(program: Command): void {
  const usb = program.command("usb").description("USB device relay and management");

  const relay = usb.command("relay").description("Manage USB relay");

  relay
    .command("start")
    .description("Start USB relay for virtual camera/microphone")
    .option("--device <id>", "Specific device ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.usb.relay.start({ deviceId: opts.device });
        console.log(chalk.green("USB relay started."));
        formatOutput(result, program.opts());
      }),
    );

  relay
    .command("stop")
    .description("Stop USB relay")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.usb.relay.stop();
        console.log(chalk.green("USB relay stopped."));
        formatOutput(result, program.opts());
      }),
    );

  usb
    .command("devices")
    .description("List connected USB devices")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.usb.devices.list();
        formatOutput(result.data, program.opts());
      }),
    );

  usb
    .command("configure <id>")
    .description("Configure a USB device")
    .option("--settings <json>", "JSON settings for the device")
    .action(
      wrapCommand(async (id: string, opts) => {
        const client = await getClient(program.opts());
        const settings = opts.settings ? JSON.parse(opts.settings as string) : undefined;
        const result = await client.usb.configure(id, { settings });
        console.log(chalk.green(`Device ${id} configured.`));
        formatOutput(result, program.opts());
      }),
    );
}
