import { Command } from "commander";
import chalk from "chalk";
import { wrapCommand } from "../../lib/errors.js";
import { formatOutput } from "../../lib/output/index.js";

const CI_BASE = process.env.WAVE_CI_BASE?.replace(/\/+$/, "") ?? "https://ci.wave.online";

function ciHeaders(): Record<string, string> {
  const secret = process.env.WAVE_CI_GATEWAY_SECRET;
  if (!secret) {
    throw new Error("WAVE_CI_GATEWAY_SECRET is not set (server-side gateway secret; see wave-ci docs).");
  }
  return { "x-wave-gateway-secret": secret, "x-wave-org": process.env.WAVE_CI_ORG ?? "wave-av" };
}

async function ciCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(CI_BASE + path, {
    method,
    headers: body !== undefined ? { ...ciHeaders(), "content-type": "application/json" } : ciHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!res.ok) {
    throw new Error(`${res.status} ${data.error?.code ?? "UNKNOWN"}: ${data.error?.message ?? "request failed"}`);
  }
  return data as T;
}

export function registerCiCommands(program: Command): void {
  const ci = program.command("ci").description("Inspect the wave-ci plane (Depot/RWX engines, billing, census)");

  ci.command("status")
    .description("wave-ci health probe (engine configuration)")
    .action(
      wrapCommand(async () => {
        formatOutput(await ciCall("GET", "/v1/ci/status"), program.opts());
      }),
    );

  ci.command("dispatch")
    .description("Dispatch a Depot workflow run")
    .requiredOption("--repo <repo>", "Repository slug (org/name)")
    .requiredOption("--workflow <workflow>", "Workflow file")
    .option("--ref <ref>", "Git ref", "main")
    .action(
      wrapCommand(async (opts: { repo: string; workflow: string; ref: string }) => {
        formatOutput(await ciCall("POST", "/v1/ci/dispatch", opts), program.opts());
      }),
    );

  ci.command("get-run")
    .description("Poll one CI run's status by runId")
    .argument("<run-id>", "Run ID")
    .action(
      wrapCommand(async (runId: string) => {
        formatOutput(await ciCall("GET", `/v1/ci/runs/${encodeURIComponent(runId)}`), program.opts());
      }),
    );

  ci.command("metrics")
    .description("CPU/mem/duration metrics for one CI run")
    .argument("<run-id>", "Run ID")
    .action(
      wrapCommand(async (runId: string) => {
        formatOutput(await ciCall("GET", `/v1/ci/runs/${encodeURIComponent(runId)}/metrics`), program.opts());
      }),
    );

  ci.command("rerun")
    .description("Re-run a finished CI workflow")
    .argument("<run-id>", "Run ID")
    .action(
      wrapCommand(async (runId: string) => {
        formatOutput(await ciCall("POST", `/v1/ci/runs/${encodeURIComponent(runId)}/rerun`), program.opts());
      }),
    );

  ci.command("rwx-dispatch")
    .description("Trigger an RWX dispatch trigger run")
    .requiredOption("--key <key>", "Dispatch trigger key")
    .requiredOption("--ref <ref>", "Git ref")
    .action(
      wrapCommand(async (opts: { key: string; ref: string }) => {
        formatOutput(await ciCall("POST", "/v1/ci/rwx/dispatch", opts), program.opts());
      }),
    );

  ci.command("captain-suites")
    .description("Captain Cloud test suites with flake counters")
    .action(
      wrapCommand(async () => {
        formatOutput(await ciCall("GET", "/v1/ci/captain/suites"), program.opts());
      }),
    );

  ci.command("billing")
    .description("GitHub org billing snapshot for a period")
    .option("--year <yyyy>", "Year")
    .option("--month <m>", "Month 1-12")
    .action(
      wrapCommand(async (opts: { year?: string; month?: string }) => {
        const qs =
          opts.year || opts.month
            ? `?${[opts.year && `year=${opts.year}`, opts.month && `month=${opts.month}`].filter(Boolean).join("&")}`
            : "";
        const data = await ciCall<Record<string, unknown>>("GET", `/v1/ci/billing${qs}`);
        if (program.opts().output && program.opts().output !== "table") {
          formatOutput(data, program.opts());
          return;
        }
        const mtd = data.mtd as { actionsNetUsd?: number } | undefined;
        console.log(chalk.bold("Actions MTD: ") + chalk.green(`$${mtd?.actionsNetUsd ?? "?"}`));
        formatOutput(data, { ...program.opts(), output: "json" });
      }),
    );
}
