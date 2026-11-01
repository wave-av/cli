import { Command } from "commander";
import { wrapCommand, CapabilityUnavailableError } from "../../lib/errors.js";

/**
 * `wave listen` streamed https://wave.online/api/webhooks/listen (the marketing host; 404
 * ROUTE_NOT_FOUND live). The WAVE API has no event-stream route for forwarding webhooks to
 * localhost, so the command stops before any network call. Platform event subscriptions ARE served:
 * `wave webhook-subscriptions list`.
 */
const LISTEN_UNAVAILABLE =
  "`wave listen` is not available: the WAVE API has no webhook event-stream route yet. Nothing " +
  "was sent. Your organization's platform event subscriptions: `wave webhook-subscriptions list`.";

export function registerListenCommands(program: Command): void {
  program
    .command("listen")
    .description("Listen for webhook events from WAVE (not yet served by the API)")
    // Kept so scripts that pass them get the "not available" answer (exit 11) rather than an
    // unknown-option error; they have no effect until the API serves an event stream.
    .option("--forward-to <url>", "Reserved: URL to forward events to (no effect yet)")
    .option("--events <pattern>", "Reserved: event pattern, e.g. stream.* (no effect yet)")
    .action(
      wrapCommand(async () => {
        throw new CapabilityUnavailableError(LISTEN_UNAVAILABLE, "listen");
      }),
    );
}
