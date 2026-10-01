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
      // file:, gopher: and similar schemes have the opaque origin "null"; name the scheme instead.
      const where = target.origin === "null" ? `a ${target.protocol} URL` : target.origin;
      throw new Error(
        `Refusing to send your WAVE credential to ${where}. \`wave api\` only calls the ` +
          `configured API host (${base.origin}); set WAVE_BASE_URL to target another WAVE environment.`,
      );
    }
    return target;
  }
  return new URL(`${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`);
}

/** An RFC 9110 field name (a "token"). */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Parse one `-H "Name: value"`, splitting on the first colon like curl. A malformed header is an
 * error, not a silent drop (1.0.10 ignored `-H X-Organization-Id` and sent the request without it).
 * A value with CR, LF or NUL is refused here with a message that names the header but never echoes
 * the value: Node's fetch would refuse it too, but its error prints the raw value to the terminal.
 */
export function parseHeader(raw: string): [string, string] {
  const colon = raw.indexOf(":");
  if (colon === -1) {
    throw new Error('-H expected "Name: value" (for example -H "Idempotency-Key: abc123").');
  }
  const name = raw.slice(0, colon).trim();
  if (!HEADER_NAME.test(name)) {
    throw new Error('-H: the text before the first ":" is not a valid header name.');
  }
  const value = raw.slice(colon + 1).trim();
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`-H ${name}: a header value cannot contain a line break or NUL.`);
  }
  return [name, value];
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

        for (const h of opts.header as string[]) {
          const [name, value] = parseHeader(h);
          headers[name] = value;
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
