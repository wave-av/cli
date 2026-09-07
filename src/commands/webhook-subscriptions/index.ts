import { Command } from "commander";
import chalk from "chalk";
import { getApiKey } from "../../lib/auth/keychain.js";
import { loadConfig } from "../../lib/config/manager.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

/**
 * Gateway-native webhook-subscription management (GET/POST /v1/webhook-subscriptions, scope
 * webhooks:read/webhooks:write — both customer-grantable). NOTE: these are WAVE platform
 * webhooks (your org's event subscriptions), distinct from `wave connect` (third-party
 * connector webhooks).
 *
 * Auth mirrors lib/api-client.ts: env WAVE_API_KEY override, else the project keychain key.
 * Base URL: env WAVE_BASE_URL override, else the project's baseUrl, else the gateway default.
 */
async function gatewayRequest(
  program: Command,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  const apiKey = process.env["WAVE_API_KEY"] ?? (await getApiKey(program.opts().project ?? process.env["WAVE_PROJECT"] ?? (await loadConfig()).currentProject));
  if (!apiKey) {
    console.error(chalk.red("No API key. Run wave login first (or set WAVE_API_KEY)."));
    process.exit(1);
  }
  const envBaseUrl = process.env["WAVE_BASE_URL"];
  const config = await loadConfig();
  const project = config.projects[program.opts().project ?? process.env["WAVE_PROJECT"] ?? config.currentProject];
  const base = envBaseUrl ?? project?.baseUrl ?? "https://api.wave.online";
  const res = await fetch(`${base}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(chalk.red(`✗ ${res.status} ${path}`));
    formatOutput(body, program.opts());
    process.exit(1);
  }
  return body;
}

export function registerWebhookSubscriptionCommands(program: Command): void {
  const webhooks = program
    .command("webhook-subscriptions")
    .description("Your organization's WAVE platform event subscriptions (gateway-native)");

  webhooks
    .command("list")
    .description("List webhook subscriptions")
    .action(
      wrapCommand(async () => {
        const result = await gatewayRequest(program, "/v1/webhook-subscriptions");
        formatOutput(result, program.opts());
      }),
    );

  webhooks
    .command("create")
    .description("Create a webhook subscription (if the gateway handler supports creation)")
    .option("--url <url>", "The endpoint URL to deliver events to")
    .option("--events <list>", "Comma-separated event names")
    .action(
      wrapCommand(async (opts) => {
        const body: Record<string, unknown> = {};
        if (opts.url) body.url = opts.url;
        if (opts.events) body.events = String(opts.events).split(",").map((s: string) => s.trim()).filter(Boolean);
        const result = await gatewayRequest(program, "/v1/webhook-subscriptions", {
          method: "POST",
          body,
        });
        console.log(chalk.green("Webhook subscription created."));
        formatOutput(result, program.opts());
      }),
    );
}

export function registerIdentityCommands(program: Command): void {
  const identity = program
    .command("identity")
    .description("Fleet agent identity directory (gateway identity-resolve)");

  identity
    .command("resolve <identifier>")
    .description("Resolve an agent identity (directory:read — operator-plane; 403 without it)")
    .action(
      wrapCommand(async (identifier: string) => {
        const result = await gatewayRequest(program, "/v1/identity/resolve", {
          method: "POST",
          body: { identifier },
        });
        formatOutput(result, program.opts());
      }),
    );
}
