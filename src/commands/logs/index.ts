import { Command } from "commander";
import { wrapCommand, CapabilityUnavailableError } from "../../lib/errors.js";

/**
 * `wave logs tail` streamed https://wave.online/api/logs/stream (the marketing host; 404
 * ROUTE_NOT_FOUND live). The WAVE API has no log-stream route, so the command stops before any
 * network call instead of printing a connection error.
 */
const LOGS_UNAVAILABLE =
  "`wave logs tail` is not available: the WAVE API has no log-stream route yet. Nothing was sent.";

export function registerLogsCommands(program: Command): void {
  const logs = program.command("logs").description("Stream application logs (not yet served by the API)");

  logs
    .command("tail")
    .description("Tail logs in real-time (not yet served by the API)")
    .option("--stream <id>", "Filter by stream ID")
    .option("--level <level>", "Minimum log level (debug, info, warn, error)", "info")
    .option("--since <duration>", "Show logs since duration (e.g., 5m, 1h)", "5m")
    .action(
      wrapCommand(async () => {
        throw new CapabilityUnavailableError(LOGS_UNAVAILABLE, "logs");
      }),
    );
}
