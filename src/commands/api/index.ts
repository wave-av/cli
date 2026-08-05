import { Command } from "commander";
import chalk from "chalk";
import { wrapCommand } from "../../lib/errors.js";
import { formatOutput } from "../../lib/output/index.js";
import { getApiKey } from "../../lib/auth/keychain.js";
import { loadConfig } from "../../lib/config/manager.js";

export function registerApiCommands(program: Command): void {
  program
    .command("api <method> <path>")
    .description("Make raw API requests (like gh api)")
    .option("-d, --data <json>", "Request body (JSON)")
    .option("-H, --header <header>", "Additional header (key:value)", collectHeaders, [])
    .option("--paginate", "Auto-paginate and collect all results")
    .action(
      wrapCommand(async (method: string, path: string, opts) => {
        const config = await loadConfig();
        const project = config.currentProject || "default";
        const apiKey = await getApiKey(project);

        if (!apiKey) {
          console.error(chalk.red("Not authenticated. Run `wave auth login` first."));
          process.exit(1);
        }

        const baseUrl = config.projects[project]?.baseUrl ?? "https://wave.online";
        const base = new URL(baseUrl);
        const requested = new URL(path, `${base.origin}/`);
        if (requested.protocol !== "https:" || requested.origin !== base.origin) {
          throw new Error("API requests must use the configured WAVE HTTPS host");
        }
        const url = requested.toString();

        const headers: Record<string, string> = {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "wave-cli/1.0.0",
        };

        // Add custom headers
        for (const h of opts.header as string[]) {
          const [key, ...valueParts] = h.split(":");
          if (key && valueParts.length > 0) {
            headers[key.trim()] = valueParts.join(":").trim();
          }
        }

        const fetchOpts: RequestInit = {
          method: method.toUpperCase(),
          headers,
        };

        if (opts.data && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
          fetchOpts.body = opts.data as string;
        }

        const res = await fetch(url, fetchOpts);
        const contentType = res.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
          const data = await res.json();

          if (!res.ok) {
            console.error(chalk.red(`${res.status} ${res.statusText}`));
            console.error(JSON.stringify(data, null, 2));
            process.exit(1);
          }

          formatOutput(data, program.opts());
        } else {
          const text = await res.text();
          if (!res.ok) {
            console.error(chalk.red(`${res.status} ${res.statusText}`));
            console.error(text);
            process.exit(1);
          }
          console.log(text);
        }
      }),
    );
}

function collectHeaders(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
