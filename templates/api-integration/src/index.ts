import { Wave } from "@wave-av/sdk";

const apiKey = process.env.WAVE_API_KEY;
if (!apiKey) {
  console.error("Set WAVE_API_KEY first (see .env.example).");
  process.exit(1);
}

const wave = new Wave({ apiKey });

interface BillingAccount {
  organizationId?: string;
  plan?: string;
}

interface BillingUsage {
  period?: { from?: string; to?: string };
  usage?: Array<Record<string, unknown>>;
}

async function main() {
  // GET /v1/billing: the organization and plan this API key acts for.
  const account = await wave.client.get<BillingAccount>("/v1/billing");
  console.log(`Organization: ${account.organizationId ?? "unknown"}`);
  console.log(`Plan:         ${account.plan ?? "unknown"}\n`);

  // GET /v1/billing/usage: billed usage for the current month (?from=YYYY-MM-DD&to=... for another range).
  const usage = await wave.client.get<BillingUsage>("/v1/billing/usage");
  const period = usage.period ? `${usage.period.from} .. ${usage.period.to}` : "the current period";
  console.log(`Usage for ${period}: ${usage.usage?.length ?? 0} line item(s)`);
  for (const line of usage.usage ?? []) {
    console.log(`  ${JSON.stringify(line)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
