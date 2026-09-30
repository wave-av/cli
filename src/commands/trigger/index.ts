import { Command } from "commander";
import { wrapCommand, CapabilityUnavailableError } from "../../lib/errors.js";

/**
 * `wave trigger` called https://wave.online/api/cli/trigger (the marketing host; 404
 * ROUTE_NOT_FOUND live). The WAVE API has no test-event route, so the command stops before any
 * network call.
 */
const TRIGGER_UNAVAILABLE =
  "`wave trigger` is not available: the WAVE API has no test-event route yet. Nothing was sent.";

export function registerTriggerCommands(program: Command): void {
  program
    .command("trigger <event>")
    .description("Trigger a WAVE event manually (not yet served by the API)")
    .option("--override <pairs...>", "Override event data (key=value pairs)")
    .option("--list", "List available trigger events")
    .action(
      wrapCommand(async () => {
        throw new CapabilityUnavailableError(TRIGGER_UNAVAILABLE, "trigger");
      }),
    );
}
