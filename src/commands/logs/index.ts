import { Command } from "commander";
import chalk from "chalk";
import { wrapCommand } from "../../lib/errors.js";
import { connectSSE, type SSEEvent } from "../../lib/sse-client.js";
import { getApiKey } from "../../lib/auth/keychain.js";
import { loadConfig } from "../../lib/config/manager.js";

const LEVEL_COLORS: Record<string, (text: string) => string> = {
  debug: chalk.gray,
  info: chalk.white,
  warn: chalk.yellow,
  error: chalk.red,
};

export function registerLogsCommands(program: Command): void {
  const logs = program.command("logs").description("Stream application logs");

  logs
    .command("tail")
    .description("Tail logs in real-time")
    .option("--stream <id>", "Filter by stream ID")
    .option("--level <level>", "Minimum log level (debug, info, warn, error)", "info")
    .option("--since <duration>", "Show logs since duration (e.g., 5m, 1h)", "5m")
    .action(
      wrapCommand(async (opts) => {
        const config = await loadConfig();
        const apiKey = await getApiKey(config.currentProject);

        if (!apiKey) {
          console.error(
            chalk.red("Not authenticated. Run `wave login` first."),
          );
          process.exit(1);
        }

        const baseUrl =
          config.projects[config.currentProject]?.baseUrl ?? "https://wave.online";
        const params = new URLSearchParams();
        params.set("level", opts.level as string);
        if (opts.stream) params.set("stream", opts.stream as string);
        if (opts.since) params.set("since", opts.since as string);
        const url = `${baseUrl}/api/logs/stream?${params}`;

        console.log(chalk.bold("WAVE Log Tail\n"));
        console.log(`  Level: ${chalk.cyan(opts.level)}`);
        console.log(`  Since: ${chalk.cyan(opts.since)}`);
        if (opts.stream) {
          console.log(`  Stream: ${chalk.cyan(opts.stream)}`);
        }
        console.log("");

        let logCount = 0;

        const controller = await connectSSE(url, apiKey, {
          onConnect() {
            console.log(chalk.green("  Connected to log stream."));
            console.log(chalk.gray("  Tailing logs... (Ctrl+C to stop)\n"));
          },
          onEvent(event: SSEEvent) {
            if (event.event === "connected" || event.event === "timeout") {
              return;
            }

            if (event.event === "log") {
              logCount++;
              const data = JSON.parse(event.data) as Record<string, unknown>;
              const level = String(data.level ?? "info");
              const timestamp = new Date().toISOString().slice(11, 23);
              const message = String(data.message ?? "");
              const colorFn = LEVEL_COLORS[level] ?? chalk.white;

              console.log(
                `${chalk.gray(timestamp)} ${colorFn(level.toUpperCase().padEnd(5))} ${message}`,
              );
            }
          },
          onError(error: Error) {
            console.error(chalk.red(`  Connection error: ${error.message}`));
          },
          onClose() {
            console.log(chalk.gray(`\n  Disconnected. ${logCount} log entries received.`));
          },
        });

        await new Promise<void>((resolve) => {
          controller.signal.addEventListener("abort", () => resolve());
        });
      }),
    );
}
