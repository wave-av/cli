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
    .option("--forward-to <url>", "URL to forward events to", "http://localhost:3000/webhooks/wave")
    .option("--events <pattern>", "Event pattern to listen for (e.g., stream.*)")
    .action(
      wrapCommand(async () => {
        throw new CapabilityUnavailableError(LISTEN_UNAVAILABLE, "listen");
      }),
    );
}
