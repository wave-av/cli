import { Command } from "commander";
// The SDK root re-exports only PulseAPI itself, not its types; the package
// declares a "./pulse" subpath export that carries them.
import type { TimeRange } from "@wave-av/sdk/pulse";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { gatewayFetch } from "../../lib/gateway.js";

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

/**
 * Account-level analytics routes the gateway serves today (GET, scope analytics:read). Each takes
 * optional ISO 8601 `from`/`to`; top-content also takes `limit` (1-100).
 */
const ACCOUNT_ANALYTICS = [
  { name: "overview", path: "/v1/analytics/overview", description: "Account-level analytics overview" },
  { name: "engagement", path: "/v1/analytics/engagement", description: "Account-wide engagement analytics" },
  { name: "top-content", path: "/v1/analytics/top-content", description: "Top content by usage" },
] as const;

export function registerAnalyticsCommands(program: Command): void {
  const analytics = program.command("analytics").description("Streaming analytics and insights");

  for (const route of ACCOUNT_ANALYTICS) {
    const cmd = analytics
      .command(route.name)
      .description(`${route.description} (GET ${route.path})`)
      .option("--from <iso>", "Range start, ISO 8601 (default: 30 days before --to)")
      .option("--to <iso>", "Range end, ISO 8601 (default: now)");
    if (route.name === "top-content") {
      cmd.option("--limit <n>", "Maximum results (1-100)", "20");
    }
    cmd.action(
      wrapCommand(async (opts: { from?: string; to?: string; limit?: string }) => {
        const { project, org } = program.opts();
        const result = await gatewayFetch(route.path, {
          project,
          org,
          query: { from: opts.from, to: opts.to, limit: opts.limit },
        });
        formatOutput(result, program.opts());
      }),
    );
  }

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
    .option("--format <format>", "Export format (csv, json, pdf)", "csv")
    .option("--period <period>", "Time period (day, week, month)", "month")
    .option("--stream-id <streamId>", "Filter by stream ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // The SDK has no direct "export" call; an export is a generated report
        // with a download_url, so route through createReport.
        const format = opts.format === "json" || opts.format === "pdf" ? opts.format : "csv";
        const result = await client.pulse.createReport({
          name: `analytics-export-${Date.now()}`,
          type: opts.streamId ? "stream-export" : "export",
          time_range: toTimeRange(opts.period),
          format,
        });
        formatOutput(result, program.opts());
      }),
    );
}
