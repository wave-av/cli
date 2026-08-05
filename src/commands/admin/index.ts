import { Command } from "commander";
import chalk from "chalk";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { loadConfig } from "../../lib/config/manager.js";
import { getApiKey } from "../../lib/auth/keychain.js";

async function adminFetch(
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
    throw new Error(error.message ?? `Admin API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export function registerAdminCommands(program: Command): void {
  const admin = program
    .command("admin")
    .description("Administrative commands (requires admin role)");

  const jobs = admin.command("jobs").description("Manage background jobs");

  jobs
    .command("list")
    .description("List background job functions")
    .option("--status <status>", "Filter by status (active, paused, failed)")
    .action(
      wrapCommand(async (opts) => {
        const params = new URLSearchParams();
        if (opts.status) params.set("status", opts.status);
        const query = params.toString();
        const result = await adminFetch(`/api/admin/jobs${query ? `?${query}` : ""}`);
        formatOutput(result, program.opts());
      }),
    );

  jobs
    .command("trigger <functionId>")
    .description("Manually trigger a background job function")
    .option("--data <json>", "JSON data payload for the job")
    .action(
      wrapCommand(async (functionId: string, opts) => {
        const data = opts.data ? JSON.parse(opts.data as string) : undefined;
        const result = await adminFetch(`/api/admin/jobs/${functionId}/trigger`, {
          method: "POST",
          body: data ? { data } : undefined,
        });
        console.log(chalk.green(`Job "${functionId}" triggered.`));
        formatOutput(result, program.opts());
      }),
    );
}
