import { Command } from "commander";
// The SDK root re-exports only PulseAPI itself, not its types; the package
// declares a "./pulse" subpath export that carries them.
import type { TimeRange } from "@wave-av/sdk/pulse";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

/**
 * The CLI has always documented `--period` as hour|day|week|month, while the SDK's
 * QueryParams takes a `time_range` of 1h|6h|24h|7d|30d|90d|custom. Translate rather
 * than forward, so the documented CLI vocabulary keeps working and the API receives
 * a value it accepts.
 */
const PERIOD_TO_TIME_RANGE: Record<string, TimeRange> = {
  hour: "1h",
  day: "24h",
  week: "7d",
  month: "30d",
};

function toTimeRange(period: string): TimeRange {
  const mapped = PERIOD_TO_TIME_RANGE[period];
  if (!mapped) {
    throw new Error(
      `Invalid --period "${period}". Expected one of: ${Object.keys(PERIOD_TO_TIME_RANGE).join(", ")}.`,
    );
  }
  return mapped;
}

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
        const result = await client.pulse.getViewerAnalytics({
          stream_id: opts.streamId,
          time_range: toTimeRange(opts.period),
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
        const result = await client.pulse.getRevenueMetrics({
          time_range: toTimeRange(opts.period),
        });
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
