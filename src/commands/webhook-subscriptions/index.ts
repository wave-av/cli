import { Command } from "commander";
import chalk from "chalk";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { gatewayFetch } from "../../lib/gateway.js";

/**
 * Gateway-native webhook-subscription management (GET/POST /v1/webhook-subscriptions, scope
 * webhooks:read/webhooks:write, both customer-grantable). NOTE: these are WAVE platform
 * webhooks (your org's event subscriptions), distinct from `wave connect` (third-party
 * connector webhooks).
 *
 * Requests go through lib/gateway.ts: the same key/host resolution as getClient(), and failures
 * are thrown as WaveErrors so `-o json` gets the structured error envelope (1.0.10 printed a human
 * "✗ 404 ..." line even in JSON mode).
 */

export function registerWebhookSubscriptionCommands(program: Command): void {
  const webhooks = program
    .command("webhook-subscriptions")
    .description("Your organization's WAVE platform event subscriptions (gateway-native)");

  webhooks
    .command("list")
    .description("List webhook subscriptions")
    .action(
      wrapCommand(async () => {
        const result = await gatewayFetch("/v1/webhook-subscriptions", { project: program.opts().project });
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
        const result = await gatewayFetch("/v1/webhook-subscriptions", {
          project: program.opts().project,
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
    .command("resolve <agent>")
    .description("Resolve a WAVE agent id to its public channel map (GET /v1/identity/resolve?agent=)")
    .action(
      wrapCommand(async (agent: string) => {
        // The served contract is GET with ?agent=<id> (1.0.10 sent POST with a JSON body, which
        // the gateway refuses as ROUTE_NOT_MAPPED).
        const result = await gatewayFetch("/v1/identity/resolve", {
          project: program.opts().project,
          query: { agent },
        });
        formatOutput(result, program.opts());
      }),
    );
}
