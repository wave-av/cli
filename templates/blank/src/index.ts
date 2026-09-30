import { Wave } from "@wave-av/sdk";

const apiKey = process.env.WAVE_API_KEY;
if (!apiKey) {
  console.error("Set WAVE_API_KEY first (see .env.example).");
  process.exit(1);
}

const wave = new Wave({ apiKey });

async function main() {
  // GET /v1/billing: the organization and plan this API key acts for.
  const account = await wave.client.get<{ organizationId?: string; plan?: string }>("/v1/billing");
  console.log(`Connected to WAVE. Organization: ${account.organizationId ?? "unknown"}, plan: ${account.plan ?? "unknown"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
