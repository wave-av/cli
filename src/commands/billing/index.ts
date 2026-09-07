import { Command } from "commander";
import chalk from "chalk";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { loadConfig } from "../../lib/config/manager.js";
import { getApiKey } from "../../lib/auth/keychain.js";

async function billingFetch(
  path: string,
  opts?: { method?: string; body?: unknown },
): Promise<unknown> {
  const config = await loadConfig();
  const project = config.projects[config.currentProject];
  const baseUrl = project?.baseUrl ?? process.env["WAVE_BASE_URL"] ?? "https://wave.online";
  const apiKey = await getApiKey(config.currentProject);

  if (!apiKey) {
    throw new Error(`No API key found. Run ${chalk.bold("wave login")} to authenticate.`);
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: opts?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Wave-Source": "cli",
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(error.message ?? `Billing API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export function registerBillingCommands(program: Command): void {
  const billing = program
    .command("billing")
    .description("Billing, usage, and subscription management");

  billing
    .command("status")
    .description("Show current billing status and plan")
    .action(
      wrapCommand(async () => {
        const result = await billingFetch("/api/billing/status");
        formatOutput(result, program.opts());
      }),
    );

  billing
    .command("usage")
    .description("Show current usage metrics")
    .option("--period <period>", "Billing period (current, previous)", "current")
    .action(
      wrapCommand(async (opts) => {
        const result = await billingFetch(`/api/billing/usage?period=${opts.period}`);
        formatOutput(result, program.opts());
      }),
    );

  billing
    .command("invoices")
    .description("List billing invoices")
    .option("--limit <n>", "Maximum results", "10")
    .action(
      wrapCommand(async (opts) => {
        const result = await billingFetch(`/api/billing/invoices?limit=${opts.limit}`);
        formatOutput(result, program.opts());
      }),
    );

  billing
    .command("limits")
    .description("Show current usage limits")
    .action(
      wrapCommand(async () => {
        const result = await billingFetch("/api/billing/limits");
        formatOutput(result, program.opts());
      }),
    );

  billing
    .command("portal")
    .description("Open the billing portal in your browser")
    .action(
      wrapCommand(async () => {
        const result = (await billingFetch("/api/billing/portal", {
          method: "POST",
        })) as { url: string };
        const open = (await import("open")).default;
        await open(result.url);
        console.log(chalk.green("Billing portal opened in your browser."));
      }),
    );

  billing
    .command("upgrade")
    .description("View available upgrade options")
    .action(
      wrapCommand(async () => {
        const result = await billingFetch("/api/billing/plans");
        formatOutput(result, program.opts());
        console.log(chalk.gray("\nTo upgrade, visit the billing portal: wave billing portal"));
      }),
    );
}
