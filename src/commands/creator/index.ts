import { Command } from "commander";
import { wrapCommand, CapabilityUnavailableError } from "../../lib/errors.js";

/**
 * Creator monetization commands (`revenue`, `payouts list`, `payouts request`, `analytics`) are
 * registered — `wave creator --help` still shows the real interface — but every action below fails
 * loudly BEFORE calling the SDK or making a network request.
 *
 * WHY (verified against wave-av/wave-gateway origin/main, 2026-09-05, not assumed from this file
 * alone): `/v1/creators/*` has no live route. It is not in the product-spoke table (spoke-routing.ts /
 * spoke-route-table*.ts), it is not a gateway-native handler (b1/b2/b3-routes.ts,
 * analytics-routes.ts, ...), and the legacy WSC core-origin fallback that used to catch stray
 * `/v1/*` paths was decommissioned 2026-08-25 (src/worker.ts, src/forward.ts: "the WSC core origin
 * fall-through has been removed"). Meanwhile "creator" IS a resolvable pricing scope
 * (scope-groups.ts) — so a request that reaches the gateway can still be quoted a payable 402 for a
 * route with nothing served behind it.
 *
 * The @wave-av/sdk methods these actions would call — `client.creator.getRevenue`, `.listPayouts`,
 * `.requestPayout`, `.getAnalytics` (basePath `/v1/creators`) — are real and correctly typed on the
 * SDK's main (this was previously the defect here; it was fixed separately). The remaining gap is
 * entirely server-side, and it is not this CLI's place to paper over it by calling through anyway:
 * a 402 is an invitation to pay, and an agent that pays before reading the body will pay regardless
 * of what the body says next (wave-gateway's own doctrine, src/unserved-spoke-routes.ts).
 *
 * HEALING: once wave-gateway ships a real `/v1/creators/*` route (tracked separately there), remove
 * the `unavailable()` call from the specific action that route now serves — a deliberate, reviewed
 * edit per command, never an automatic unlock. Do not remove all four at once "to be safe"; heal each
 * action only after confirming ITS route is live.
 */
const CREATOR_BACKEND_UNAVAILABLE =
  "Creator monetization is not available: WAVE has no live backend behind /v1/creators/* today. " +
  "This is a platform-wide gap, not a restriction on your account or plan — no login, upgrade, or " +
  "payment unlocks it. The underlying SDK method is real; the gateway route behind it is not yet " +
  "served. Track wave-av/wave-gateway for when creator monetization ships, then retry.";

function unavailable(): never {
  throw new CapabilityUnavailableError(CREATOR_BACKEND_UNAVAILABLE, "creator");
}

export function registerCreatorCommands(program: Command): void {
  const creator = program.command("creator").description("Creator monetization and analytics");

  creator
    .command("revenue")
    .description("View revenue summary (not yet available — no live backend, see --help output)")
    .requiredOption("--creator-id <creatorId>", "Creator ID")
    .option("--period <period>", "Time period (day, week, month)", "month")
    .action(wrapCommand(async () => unavailable()));

  const payouts = creator.command("payouts").description("Manage payouts");

  payouts
    .command("list")
    .description("List payout history (not yet available — no live backend)")
    .requiredOption("--creator-id <creatorId>", "Creator ID")
    .option("--limit <n>", "Maximum results", "20")
    .action(wrapCommand(async () => unavailable()));

  payouts
    .command("request")
    .description("Request a payout (not yet available — no live backend)")
    .requiredOption("--creator-id <creatorId>", "Creator ID")
    .requiredOption("--amount-cents <cents>", "Payout amount in cents")
    .requiredOption("--method <method>", "Payout method (bank_transfer, paypal, stripe)")
    .action(wrapCommand(async () => unavailable()));

  creator
    .command("analytics")
    .description("View creator analytics (not yet available — no live backend)")
    .requiredOption("--creator-id <creatorId>", "Creator ID")
    .option("--period <period>", "Time period (day, week, month)", "month")
    .action(wrapCommand(async () => unavailable()));
}
