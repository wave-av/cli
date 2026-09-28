import { Command } from "commander";
import chalk from "chalk";
import { wrapCommand } from "../../lib/errors.js";
import { connectSSE, type SSEEvent } from "../../lib/sse-client.js";
import { getApiKey } from "../../lib/auth/keychain.js";
import { loadConfig } from "../../lib/config/manager.js";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import type { ListenSession, ListenSessionListResponse } from "./types.js";

export function registerListenCommands(program: Command): void {
  const listen = program
    .command("listen")
    .description("Listen for webhook events from WAVE")
    .option("--forward-to <url>", "URL to forward events to", "http://localhost:3000/webhooks/wave")
    .option("--events <pattern>", "Event pattern to listen for (e.g., stream.*)")
    .action(
      wrapCommand(async (opts) => {
        const config = await loadConfig();
        const apiKey = await getApiKey(config.currentProject);
        if (!apiKey) {
          console.error(chalk.red("Not authenticated. Run `wave login` first."));
          process.exit(1);
        }

        const baseUrl = config.projects[config.currentProject]?.baseUrl ?? "https://wave.online";
        const params = new URLSearchParams();
        if (opts.events) params.set("events", opts.events as string);
        const url = `${baseUrl}/api/webhooks/listen${params.toString() ? `?${params}` : ""}`;

        console.log(chalk.bold("WAVE Event Listener\n"));
        console.log(`  Forward URL:  ${chalk.cyan(opts.forwardTo)}`);
        if (opts.events) console.log(`  Event filter: ${chalk.cyan(opts.events)}`);
        console.log("");

        let eventCount = 0;
        const controller = await connectSSE(url, apiKey, {
          onConnect() {
            console.log(chalk.green("  Connected to event stream."));
            console.log(chalk.gray("  Waiting for events... (Ctrl+C to stop)\n"));
          },
          onEvent(event: SSEEvent) {
            if (event.event === "connected" || event.event === "timeout") return;
            if (event.event === "webhook") {
              eventCount++;
              const data = JSON.parse(event.data) as Record<string, unknown>;
              const timestamp = new Date().toISOString().slice(11, 23);
              const eventType = String(data.type ?? "unknown");
              console.log(`${chalk.gray(timestamp)} ${chalk.cyan(`[${eventType}]`)} ${chalk.white(JSON.stringify(data).slice(0, 120))}`);
              fetch(opts.forwardTo as string, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
              }).catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(chalk.red(`  Forward failed: ${msg}`));
              });
            }
          },
          onError(error: Error) { console.error(chalk.red(`  Connection error: ${error.message}`)); },
          onClose() { console.log(chalk.gray(`\n  Disconnected. ${eventCount} events received.`)); },
        });

        await new Promise<void>((resolve) => {
          controller.signal.addEventListener("abort", () => resolve());
        });
      }),
    );

  // `wave listen sessions *` — the unrelated "Listen" media spoke's session routes
  // (`/v1/listen/sessions`), nested under the existing `listen` command rather than given a new
  // top-level name: `wave listen` (no subcommand) keeps its webhook-forwarding behavior above,
  // unchanged, for backward compatibility. No dedicated `listen` SDK module exists yet; reached
  // through the SDK's already-published generic client, same pattern as `wave srt`/`wave moq`.
  const sessions = listen.command("sessions").description("Manage Listen media sessions");

  sessions
    .command("create")
    .description("Create a Listen session (POST /v1/listen/sessions)")
    .requiredOption("--title <title>", "Session title")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.client.post<ListenSession>("/v1/listen/sessions", { title: opts.title });
        console.log(chalk.green(`Listen session created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  sessions
    .command("list")
    .description("List Listen sessions (GET /v1/listen/sessions)")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.client.get<ListenSessionListResponse>("/v1/listen/sessions", {
          params: { limit: Number(opts.limit) },
        });
        formatOutput(result.data, program.opts());
      }),
    );

  sessions
    .command("get <id>")
    .description("Get a Listen session (GET /v1/listen/sessions/:id)")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.client.get<ListenSession>(`/v1/listen/sessions/${encodeURIComponent(id)}`);
        formatOutput(result, program.opts());
      }),
    );
}
