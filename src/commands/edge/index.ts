import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/output/index.js";

export function registerEdgeCommands(program: Command): void {
  const edge = program.command("edge").description("Edge processing and CDN management");

  const cache = edge.command("cache").description("Manage edge cache");

  cache
    .command("status")
    .description("Show edge cache status")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.edge.cache.status();
        formatOutput(result, program.opts());
      }),
    );

  cache
    .command("purge")
    .description("Purge edge cache")
    .option("--path <path>", "Specific path to purge (purges all if omitted)")
    .action(
      wrapCommand(async (opts) => {
        const target = opts.path ?? "all cache entries";
        const confirmed = await confirmDestructive("purge", target, program.opts());
        if (!confirmed) return;
        const client = await getClient(program.opts());
        const result = await client.edge.cache.purge({ path: opts.path });
        console.log(chalk.green("Cache purge initiated."));
        formatOutput(result, program.opts());
      }),
    );

  const workers = edge.command("workers").description("Manage edge workers");

  workers
    .command("list")
    .description("List edge workers")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.edge.workers.list();
        formatOutput(result.data, program.opts());
      }),
    );

  const rules = edge.command("rules").description("Manage edge rules");

  rules
    .command("list")
    .description("List edge rules")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.edge.rules.list();
        formatOutput(result.data, program.opts());
      }),
    );

  rules
    .command("create")
    .description("Create an edge rule")
    .requiredOption("--pattern <pattern>", "URL pattern to match")
    .requiredOption("--action <action>", "Rule action (cache, redirect, block)")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.edge.rules.create({
          pattern: opts.pattern,
          action: opts.action,
        });
        console.log(chalk.green(`Edge rule created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );
}
