import { Command } from "commander";
import { wrapCommand, CapabilityUnavailableError } from "../../lib/errors.js";

/**
 * `wave admin jobs list|trigger` called https://wave.online/api/admin/jobs (the marketing host;
 * 404 ROUTE_NOT_FOUND live) and the WAVE API has no admin-jobs route. Registered so `--help` still
 * shows the interface, but every action stops before any network call.
 */
const ADMIN_UNAVAILABLE =
  "`wave admin jobs` is not available: the WAVE API has no background-jobs route. Nothing was sent.";

function unavailable(): never {
  throw new CapabilityUnavailableError(ADMIN_UNAVAILABLE, "admin");
}

export function registerAdminCommands(program: Command): void {
  const admin = program
    .command("admin")
    .description("Administrative commands (requires admin role)");

  const jobs = admin.command("jobs").description("Manage background jobs (not yet served by the API)");

  jobs
    .command("list")
    .description("List background job functions (not yet served by the API)")
    .option("--status <status>", "Filter by status (active, paused, failed)")
    .action(wrapCommand(async () => unavailable()));

  jobs
    .command("trigger <functionId>")
    .description("Manually trigger a background job function (not yet served by the API)")
    .option("--data <json>", "JSON data payload for the job")
    .action(wrapCommand(async () => unavailable()));
}
