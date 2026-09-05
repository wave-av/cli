import { Command } from "commander";
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
        // DesktopAPI is entirely node-id-scoped (getInfo/getStatus/listDevices/...)
        // — there is no enumerate-all-nodes route in the current SDK.
        throw new Error(
          "Listing desktop nodes is not supported by the current SDK. Use `wave desktop status <id>` for a known node.",
        );
      }),
    );

  desktop
    .command("pair")
    .description("Pair a desktop node")
    .requiredOption("--code <code>", "Pairing code from the desktop application")
    .action(
      wrapCommand(async () => {
        // The SDK has no pairing-code exchange endpoint for DesktopAPI.
        throw new Error("Pairing a desktop node is not supported by the current SDK.");
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
