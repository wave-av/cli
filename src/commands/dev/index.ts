import { Command } from "commander";
import chalk from "chalk";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
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

interface ProjectLinkConfig {
  projectId: string;
  organizationId: string;
  projectName: string;
}

/**
 * Attempts to load `.wave/project.json` from the current directory.
 * Returns null if not found or invalid.
 */
async function loadProjectConfig(): Promise<ProjectLinkConfig | null> {
  const projectJsonPath = join(resolve(process.cwd()), ".wave", "project.json");
  if (!existsSync(projectJsonPath)) {
    return null;
  }
  try {
    const raw = await readFile(projectJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.projectId === "string" &&
      typeof parsed.organizationId === "string" &&
      typeof parsed.projectName === "string"
    ) {
      return parsed as unknown as ProjectLinkConfig;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Detects the local dev server port by inspecting the nearest package.json.
 * Looks for common port patterns in "dev" or "start" scripts.
 * Falls back to 3000 if no port is detected.
 */
async function detectLocalPort(): Promise<number> {
  const pkgPath = join(resolve(process.cwd()), "package.json");
  if (!existsSync(pkgPath)) {
    return 3000;
  }
  try {
    const raw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const scripts = pkg.scripts as Record<string, string> | undefined;
    if (!scripts) return 3000;

    // Check dev and start scripts for port patterns
    const devScript = scripts.dev ?? scripts.start ?? "";
    // Match --port 3001, -p 4000, PORT=8080, :3001, etc.
    const portMatch = devScript.match(
      /(?:--port\s+|(?:^|\s)-p\s+|PORT=|:)(\d{4,5})/,
    );
    if (portMatch) {
      const port = parseInt(portMatch[1], 10);
      if (port > 0 && port < 65536) return port;
    }
    return 3000;
  } catch {
    return 3000;
  }
}

export function registerDevCommands(program: Command): void {
  program
    .command("dev")
    .description(
      "Start unified development proxy (webhook forwarding + log streaming)",
    )
    .option(
      "--forward-to <url>",
      "URL to forward webhook events to (overrides auto-detected port)",
    )
    .option("--port <number>", "Local server port (overrides auto-detection)")
    .option(
      "--log-level <level>",
      "Minimum log level (debug, info, warn, error)",
      "info",
    )
    .option("--events <pattern>", "Event pattern to filter (e.g., stream.*)")
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
          config.projects[config.currentProject]?.baseUrl ??
          "https://wave.online";

        // Load project config from .wave/project.json if available
        const projectConfig = await loadProjectConfig();

        // Determine local port: explicit --port > --forward-to > auto-detect
        let forwardUrl: string;
        if (opts.forwardTo) {
          forwardUrl = opts.forwardTo as string;
        } else {
          const port = opts.port
            ? parseInt(opts.port as string, 10)
            : await detectLocalPort();
          forwardUrl = `http://localhost:${port}/webhooks/wave`;
        }

        // Display startup banner
        console.log(chalk.bold("WAVE Development Mode\n"));

        if (projectConfig) {
          console.log(
            `  Project:            ${chalk.cyan(projectConfig.projectName)} ${chalk.dim(`(${projectConfig.projectId})`)}`,
          );
        } else {
          console.log(
            chalk.dim(
              "  No .wave/project.json found. Run `wave link` to connect a project.",
            ),
          );
        }

        console.log(
          `  Webhook forwarding: ${chalk.cyan(forwardUrl)}`,
        );
        console.log(
          `  Log level:          ${chalk.cyan(opts.logLevel)}`,
        );
        if (opts.events) {
          console.log(
            `  Event filter:       ${chalk.cyan(opts.events)}`,
          );
        }
        console.log("");
        console.log(chalk.dim("  Starting development proxy...\n"));

        let webhookCount = 0;
        let logCount = 0;
        let errorCount = 0;

        // Build webhook SSE URL with optional event filter
        const webhookParams = new URLSearchParams();
        if (opts.events) webhookParams.set("events", opts.events as string);
        const webhookUrl = `${baseUrl}/api/webhooks/listen${webhookParams.toString() ? `?${webhookParams}` : ""}`;

        const webhookController = await connectSSE(webhookUrl, apiKey, {
          onConnect() {
            console.log(
              chalk.green("  [webhook] Connected to event stream"),
            );
          },
          onEvent(event: SSEEvent) {
            if (event.event === "connected" || event.event === "timeout")
              return;
            if (event.event === "webhook") {
              webhookCount++;
              const data = JSON.parse(event.data) as Record<string, unknown>;
              const timestamp = new Date().toISOString().slice(11, 23);
              const eventType = String(data.type ?? "unknown");
              console.log(
                `${chalk.gray(timestamp)} ${chalk.magenta("[webhook]")} ${chalk.cyan(eventType)} ${chalk.white(JSON.stringify(data).slice(0, 100))}`,
              );
              fetch(forwardUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
              }).catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(
                  `${chalk.gray(new Date().toISOString().slice(11, 23))} ${chalk.red("[error]")}   Forward failed: ${msg}`,
                );
                errorCount++;
              });
            }
          },
          onError(error: Error) {
            console.error(
              chalk.red(`  [webhook] Error: ${error.message}`),
            );
            errorCount++;
          },
        });

        // Build log SSE URL with level filter
        const logParams = new URLSearchParams();
        logParams.set("level", opts.logLevel as string);
        const logUrl = `${baseUrl}/api/logs/stream?${logParams}`;

        const logController = await connectSSE(logUrl, apiKey, {
          onConnect() {
            console.log(
              chalk.green("  [log]     Connected to log stream"),
            );
            console.log(chalk.gray("\n  Ready. Ctrl+C to stop.\n"));
          },
          onEvent(event: SSEEvent) {
            if (event.event === "connected" || event.event === "timeout")
              return;
            if (event.event === "log") {
              logCount++;
              const data = JSON.parse(event.data) as Record<string, unknown>;
              const level = String(data.level ?? "info");
              const timestamp = new Date().toISOString().slice(11, 23);
              const message = String(data.message ?? "");
              const colorFn = LEVEL_COLORS[level] ?? chalk.white;
              console.log(
                `${chalk.gray(timestamp)} ${chalk.blue("[log]")}     ${colorFn(level.toUpperCase().padEnd(5))} ${message}`,
              );
            }
          },
          onError(error: Error) {
            console.error(
              chalk.red(`  [log]     Error: ${error.message}`),
            );
            errorCount++;
          },
        });

        // Wait for shutdown signal
        await new Promise<void>((resolve) => {
          const done = () => {
            webhookController.abort();
            logController.abort();
            resolve();
          };
          process.on("SIGINT", done);
          process.on("SIGTERM", done);
        });

        console.log(
          chalk.gray(
            `\n  Session ended. ${webhookCount} webhook events, ${logCount} log entries, ${errorCount} errors.`,
          ),
        );
      }),
    );
}
