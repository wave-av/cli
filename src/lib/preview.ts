import chalk from "chalk";

/**
 * Preview-route guard.
 *
 * Some `wave` command groups target a route that is not on the public API today (verified via
 * the GA readiness audit: `/v1/streams` and `/v1/phone` both return 404 ROUTE_NOT_FOUND — "no
 * spoke and no override"). Those commands must fail LOUDLY, with an actionable message, and —
 * the part that matters most — WITHOUT EVER constructing an SDK client or making a network call:
 * a call that reached the gateway risks a payable 402 for a route that serves nothing.
 *
 * Always prints plain text (not JSON) regardless of `--output`: the message itself, verbatim, is
 * the contract this lane is proven against (see the lane's `liveProof`), so it is never wrapped
 * in a structured envelope that could hide it from a simple substring check.
 *
 * Exits with code 2 (distinct from `EXIT_CODES.NOT_IMPLEMENTED`/11 used elsewhere in this CLI for
 * backend-unavailable guards) because this go-live lane's contract calls that code out by number.
 */
export function previewExit(message: string): never {
  console.error(chalk.yellow(message));
  process.exit(2);
}
