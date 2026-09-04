import { Command } from "commander";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerAnalyticsCommands(program: Command): void {
  const analytics = program.command("analytics").description("Streaming analytics and insights");

  analytics
    .command("viewers")
    .description("View audience analytics")
    .option("--stream-id <streamId>", "Filter by stream ID")
    .option("--period <period>", "Time period (hour, day, week, month)", "day")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.pulse.viewers({
          streamId: opts.streamId,
          period: opts.period,
        });
        formatOutput(result, program.opts());
      }),
    );

  analytics
    .command("revenue")
    .description("View revenue analytics")
    .option("--period <period>", "Time period (day, week, month)", "month")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.pulse.revenue({ period: opts.period });
        formatOutput(result, program.opts());
      }),
    );

  analytics
    .command("export")
    .description("Export analytics data")
    .option("--format <format>", "Export format (csv, json)", "csv")
    .option("--period <period>", "Time period (day, week, month)", "month")
    .option("--stream-id <streamId>", "Filter by stream ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.pulse.export({
          format: opts.format,
          period: opts.period,
          streamId: opts.streamId,
        });
        formatOutput(result, program.opts());
      }),
    );
}
