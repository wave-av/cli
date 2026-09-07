import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { optionalOneOf } from "../../lib/options.js";
import { confirmDestructive } from "../../lib/output/index.js";

export function registerVaultCommands(program: Command): void {
  const vault = program.command("vault").description("Recording vault and archive management");

  const recordings = vault.command("recordings").description("Manage vault recordings");

  recordings
    .command("list")
    .description("List recordings in the vault")
    .option("--limit <n>", "Maximum results", "20")
    .option(
      "--status <status>",
      "Filter by status (recording, processing, ready, archived, failed)",
    )
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.vault.list({
          limit: parseInt(opts.limit),
          status: optionalOneOf("--status", opts.status, [
            "recording",
            "processing",
            "ready",
            "archived",
            "failed",
          ]),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  recordings
    .command("get <id>")
    .description("Get recording details")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.vault.get(id);
        formatOutput(result, program.opts());
      }),
    );

  recordings
    .command("delete <id>")
    .description("Delete a recording from the vault")
    .action(
      wrapCommand(async (id: string) => {
        const confirmed = await confirmDestructive(
          "permanently delete",
          `recording ${id}`,
          program.opts(),
        );
        if (!confirmed) return;
        const client = await getClient(program.opts());
        await client.vault.remove(id);
        console.log(chalk.green(`Recording ${id} deleted.`));
      }),
    );

  vault
    .command("archive <id>")
    .description("Archive a recording to cold storage")
    .action(
      wrapCommand(async () => {
        // VaultAPI's update() covers title/tags/metadata only — there is no
        // storage-tier mutation route to move a recording to cold storage.
        throw new Error("Archiving a recording to cold storage is not supported by the current SDK.");
      }),
    );

  vault
    .command("restore <id>")
    .description("Restore an archived recording")
    .action(
      wrapCommand(async () => {
        throw new Error("Restoring an archived recording is not supported by the current SDK.");
      }),
    );
}
