import { Command } from "commander";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand, CapabilityUnavailableError } from "../../lib/errors.js";
import { gatewayFetch } from "../../lib/gateway.js";

/**
 * Billing reads go to the gateway's served routes on api.wave.online:
 *   GET /v1/billing         -> { organizationId, billingAccount, plan, subscription, paymentMethod }
 *   GET /v1/billing/usage   -> { organizationId, period:{from,to}, usage[], total }   (?from&to)
 *
 * 1.0.10 called https://wave.online/api/billing/* (the marketing host, 404 ROUTE_NOT_FOUND on every
 * path) with a keychain-only key. invoices / limits / portal / upgrade have no API route today, so
 * they stop before any network call instead of failing with an opaque 404.
 */

const BILLING_UNSERVED =
  "is not available from the CLI yet: the WAVE API has no route for it. " +
  "`wave billing status` (plan, subscription, payment method) and `wave billing usage` are served.";

function unavailable(command: string): never {
  throw new CapabilityUnavailableError(`\`wave billing ${command}\` ${BILLING_UNSERVED}`, "billing");
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `--period current|previous` -> the from/to range GET /v1/billing/usage takes (UTC months). */
export function periodRange(period: string, now = new Date()): { from?: string; to?: string } {
  if (period === "current") return {}; // server default: start of this month .. today
  if (period === "previous") {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { from: isoDate(from), to: isoDate(to) };
  }
  throw new Error(`Invalid --period "${period}". Expected one of: current, previous.`);
}

export function registerBillingCommands(program: Command): void {
  const billing = program
    .command("billing")
    .description("Billing, usage, and subscription management");

  billing
    .command("status")
    .description("Show current billing status and plan (GET /v1/billing)")
    .action(
      wrapCommand(async () => {
        const result = await gatewayFetch("/v1/billing", { project: program.opts().project });
        formatOutput(result, program.opts());
      }),
    );

  billing
    .command("usage")
    .description("Show billed usage for a date range (GET /v1/billing/usage)")
    .option("--period <period>", "Billing period (current, previous)", "current")
    .option("--from <date>", "Range start, YYYY-MM-DD (overrides --period)")
    .option("--to <date>", "Range end, YYYY-MM-DD (overrides --period)")
    .action(
      wrapCommand(async (opts: { period: string; from?: string; to?: string }) => {
        const range = periodRange(opts.period);
        const result = await gatewayFetch("/v1/billing/usage", {
          project: program.opts().project,
          query: { from: opts.from ?? range.from, to: opts.to ?? range.to },
        });
        formatOutput(result, program.opts());
      }),
    );

  billing
    .command("invoices")
    .description("List billing invoices (not yet served by the API)")
    .option("--limit <n>", "Maximum results", "10")
    .action(wrapCommand(async () => unavailable("invoices")));

  billing
    .command("limits")
    .description("Show current usage limits (not yet served by the API)")
    .action(wrapCommand(async () => unavailable("limits")));

  billing
    .command("portal")
    .description("Open the billing portal in your browser (not yet served by the API)")
    .action(wrapCommand(async () => unavailable("portal")));

  billing
    .command("upgrade")
    .description("View available upgrade options (not yet served by the API)")
    .action(wrapCommand(async () => unavailable("upgrade")));
}
