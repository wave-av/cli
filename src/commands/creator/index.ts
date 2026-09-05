import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { oneOf } from "../../lib/options.js";

export function registerCreatorCommands(program: Command): void {
  const creator = program.command("creator").description("Creator monetization and analytics");

  creator
    .command("revenue")
    .description("View revenue summary")
    .requiredOption("--creator-id <creatorId>", "Creator ID")
    .option("--period <period>", "Time period (day, week, month)", "month")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.creator.getRevenue(opts.creatorId, {
          period: opts.period,
        });
        formatOutput(result, program.opts());
      }),
    );

  const payouts = creator.command("payouts").description("Manage payouts");

  payouts
    .command("list")
    .description("List payout history")
    .requiredOption("--creator-id <creatorId>", "Creator ID")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.creator.listPayouts(opts.creatorId, {
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  payouts
    .command("request")
    .description("Request a payout")
    .requiredOption("--creator-id <creatorId>", "Creator ID")
    .requiredOption("--amount-cents <cents>", "Payout amount in cents")
    .requiredOption("--method <method>", "Payout method (bank_transfer, paypal, stripe)")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // The API takes an explicit amount in cents and a method; there is no
        // "full balance" sentinel, so both are required rather than inferred.
        const result = await client.creator.requestPayout(opts.creatorId, {
          amount_cents: parseInt(opts.amountCents),
          method: oneOf("--method", opts.method, ["bank_transfer", "paypal", "stripe"]),
        });
        console.log(chalk.green("Payout requested."));
        formatOutput(result, program.opts());
      }),
    );

  creator
    .command("analytics")
    .description("View creator analytics")
    .requiredOption("--creator-id <creatorId>", "Creator ID")
    .option("--period <period>", "Time period (day, week, month)", "month")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.creator.getAnalytics(opts.creatorId, {
          period: opts.period,
        });
        formatOutput(result, program.opts());
      }),
    );
}
