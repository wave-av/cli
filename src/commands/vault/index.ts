import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/output/index.js";

export function registerVaultCommands(program: Command): void {
  const vault = program.command("vault").description("Recording vault and archive management");

  const recordings = vault.command("recordings").description("Manage vault recordings");

  recordings
    .command("list")
    .description("List recordings in the vault")
    .option("--limit <n>", "Maximum results", "20")
    .option("--status <status>", "Filter by status (active, archived)")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const params: Record<string, unknown> = {
          limit: parseInt(opts.limit),
        };
        if (opts.status) params.status = opts.status;
        const result = await client.vault.recordings.list(params);
        formatOutput(result.data, program.opts());
      }),
    );

  recordings
    .command("get <id>")
    .description("Get recording details")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.vault.recordings.get(id);
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
        await client.vault.recordings.delete(id);
        console.log(chalk.green(`Recording ${id} deleted.`));
      }),
    );

  vault
    .command("archive <id>")
    .description("Archive a recording to cold storage")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.vault.archive(id);
        console.log(chalk.green(`Recording ${id} archived.`));
        formatOutput(result, program.opts());
      }),
    );

  vault
    .command("restore <id>")
    .description("Restore an archived recording")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.vault.restore(id);
        console.log(chalk.green(`Recording ${id} restoration started.`));
        formatOutput(result, program.opts());
      }),
    );
}
