import { Command } from "commander";
import chalk from "chalk";
import { AuthRequiredError, exitCodeFor, wrapCommand } from "../../lib/errors.js";
import { formatOutput } from "../../lib/output/index.js";
import { resolveCredentials } from "../../lib/auth/credentials.js";
import { toGatewayError } from "../../lib/gateway.js";
import { sanitizeForTerminal } from "../../lib/terminal.js";
import { cliUserAgent } from "../../lib/version.js";

/**
 * Build the request URL for `wave api`. Relative paths resolve against the configured API host.
 * An absolute URL is accepted only on that same origin: the command attaches your WAVE credential
 * as a bearer token, and it must never be sent to an arbitrary host a typo or a pasted link names.
 */
export function buildApiUrl(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    const target = new URL(path);
    if (target.origin !== base.origin) {
      throw new Error(
        `Refusing to send your WAVE credential to ${target.origin}. \`wave api\` only calls the ` +
          `configured API host (${base.origin}); set WAVE_BASE_URL to target another WAVE environment.`,
      );
    }
    return target;
  }
  return new URL(`${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`);
}

export function registerApiCommands(program: Command): void {
  program
    .command("api <method> <path>")
    .description("Make raw API requests (like gh api)")
    .option("-d, --data <json>", "Request body (JSON)")
    .option("-H, --header <header>", "Additional header (key:value)", collectHeaders, [])
    .option("--paginate", "Auto-paginate and collect all results")
    .action(
      wrapCommand(async (method: string, path: string, opts) => {
        // Same resolution as every other command: WAVE_API_KEY first, then the stored key; the
        // host is WAVE_BASE_URL / the project's baseUrl / https://api.wave.online. 1.0.10
        // defaulted to https://wave.online (the marketing site) and ignored WAVE_API_KEY.
        const creds = await resolveCredentials({ project: program.opts().project, org: program.opts().org });
        if (!creds) {
          throw new AuthRequiredError();
        }

        const url = buildApiUrl(creds.baseUrl, path);

        const headers: Record<string, string> = {
          Authorization: `Bearer ${creds.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": cliUserAgent(),
          "X-Wave-Source": "cli",
        };
        // --org / WAVE_ORG_ID / the saved org, as for every other command (-H can still override).
        if (creds.organizationId) headers["X-Organization-Id"] = creds.organizationId;

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
        const text = await res.text();
        let data: unknown = text;
        if (contentType.includes("application/json") && text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        }

        if (!res.ok) {
          // Like `gh api`, show the response itself, but exit with the code every other command
          // uses for the same failure (401 -> 2, 403 -> 7, ROUTE_NOT_FOUND/ROUTE_NOT_MAPPED -> 11
          // "not served"), not a blanket 1, so scripts can tell the cases apart.
          const failure = toGatewayError(
            res.status,
            res.statusText,
            typeof data === "string" ? { message: data.slice(0, 500) } : data,
            res.headers.get("x-request-id") ?? undefined,
          );
          console.error(chalk.red(`${res.status} ${res.statusText}`));
          console.error(sanitizeForTerminal(typeof data === "string" ? data : JSON.stringify(data, null, 2)));
          process.exitCode = exitCodeFor(failure);
          return;
        }

        if (typeof data === "string") {
          console.log(data);
        } else {
          formatOutput(data, program.opts());
        }
      }),
    );
}

function collectHeaders(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
