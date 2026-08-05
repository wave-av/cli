import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerCreatorCommands(program: Command): void {
  const creator = program.command("creator").description("Creator monetization and analytics");

  creator
    .command("revenue")
    .description("View revenue summary")
    .option("--period <period>", "Time period (day, week, month)", "month")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.creator.revenue({ period: opts.period });
        formatOutput(result, program.opts());
      }),
    );

  const payouts = creator.command("payouts").description("Manage payouts");

  payouts
    .command("list")
    .description("List payout history")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.creator.payouts.list({
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  payouts
    .command("request")
    .description("Request a payout")
    .option("--amount <amount>", "Payout amount (uses full balance if omitted)")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const params: Record<string, unknown> = {};
        if (opts.amount) params.amount = parseFloat(opts.amount);
        const result = await client.creator.payouts.request(params);
        console.log(chalk.green("Payout requested."));
        formatOutput(result, program.opts());
      }),
    );

  creator
    .command("analytics")
    .description("View creator analytics")
    .option("--period <period>", "Time period (day, week, month)", "month")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.creator.analytics({ period: opts.period });
        formatOutput(result, program.opts());
      }),
    );
}
