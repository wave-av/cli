import { Command } from "commander";
import { wrapCommand, CapabilityUnavailableError } from "../../lib/errors.js";

/**
 * `wave dev` combined two event streams on https://wave.online (the marketing host):
 * /api/webhooks/listen and /api/logs/stream. Both return 404 ROUTE_NOT_FOUND live, and the WAVE API
 * has no equivalent route, so the command stops before any network call instead of reporting two
 * connection errors and idling.
 */
const DEV_UNAVAILABLE =
  "`wave dev` is not available: the webhook and log streams it combines are not served by the " +
  "WAVE API yet. Nothing was sent.";

export function registerDevCommands(program: Command): void {
  program
    .command("dev")
    .description(
      "Start unified development proxy (webhook forwarding + log streaming; not yet served by the API)",
    )
    .option(
      "--forward-to <url>",
      "URL to forward webhook events to (overrides auto-detected port)",
    )
    .option("--port <number>", "Local server port (overrides auto-detection)")
    .option(
      "--log-level <level>",
      "Minimum log level (debug, info, warn, error)",
      "info",
    )
    .option("--events <pattern>", "Event pattern to filter (e.g., stream.*)")
    .action(
      wrapCommand(async () => {
        throw new CapabilityUnavailableError(DEV_UNAVAILABLE, "dev");
      }),
    );
}
