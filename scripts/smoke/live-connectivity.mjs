#!/usr/bin/env node
// Live connectivity smoke for @wave-av/cli against the real WAVE API.
//
// Drives the CLI binary end to end (not the source) and asserts that each connectivity path the
// 1.0.10 probe found broken now reaches a SERVED route and gets real data back. A bare 200 is not
// accepted as proof: every check asserts a body marker (a field only the right handler returns),
// and the run first confirms two known-served control routes answer, so an outage cannot pass
// as "fixed".
//
// Usage (after `npm run build`):
//   WAVE_API_KEY=... node scripts/smoke/live-connectivity.mjs
//   WAVE_API_KEY=... node scripts/smoke/live-connectivity.mjs --bin "$(command -v wave)"   # an installed CLI
//   ... --device   also start (never approve) one device-flow ceremony; it expires on its own
//
// Safety:
//   - Sends only GET requests with the key (plus, with --device, unauthenticated POSTs that create
//     one unapproved ceremony and poll it for 15s). No writes, nothing billed.
//   - Runs the CLI with a throwaway HOME and WAVE_CREDENTIAL_STORE=file, so the stored-key path
//     is exercised without touching your OS keychain or ~/.wave.
//   - The key is never printed (every captured line is scrubbed) and never passed as an argument:
//     children get it from the environment or on stdin (`login --api-key-stdin`), so it does not
//     show up in the process list.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const binFlag = args.indexOf("--bin");
// Absolute before anything uses it: the CLI runs with cwd set to a throwaway HOME, where a relative
// `--bin ./dist/index.js` would no longer point at the binary that the existence check found.
const BIN = binFlag >= 0 ? resolve(args[binFlag + 1] ?? "") : join(ROOT, "dist", "index.js");
const WITH_DEVICE = args.includes("--device");
const KEY = process.env.WAVE_API_KEY ?? "";
const BASE = (process.env.WAVE_BASE_URL || "https://api.wave.online").replace(/\/+$/, "");

if (!KEY) {
  console.error("WAVE_API_KEY is not set. Inject it from your secret manager; it is never printed.");
  process.exit(2);
}
if (!existsSync(BIN)) {
  console.error(`CLI binary not found at ${BIN}. Run \`npm run build\` or pass --bin <path>.`);
  process.exit(2);
}

const scrub = (s) => String(s ?? "").split(KEY).join("[REDACTED]");
const home = mkdtempSync(join(tmpdir(), "wave-cli-smoke-"));
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail: scrub(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${scrub(detail)}`);
}

/**
 * The JavaScript entry behind an npm `.cmd`/`.bat` shim (Windows global installs create `wave.cmd`).
 * Node refuses to spawn a batch file without a shell (CVE-2024-27980), and a shell is exactly what
 * this script must not use, so read the shim instead: npm's cmd-shim runs
 * `"%_prog%" "%dp0%\node_modules\@wave-av\cli\dist\index.js" %*`, and that quoted, `%dp0%`-relative
 * script is the entry this node then runs directly, the same way a `.js` --bin is run.
 */
function shimEntry(shimPath) {
  const shim = readFileSync(shimPath, "utf-8");
  const target = shim.match(/"%~?dp0%?\\([^"%]+\.(?:c?js|mjs))"/i)?.[1];
  if (!target) {
    console.error(`${shimPath} is not an npm cmd-shim for a JavaScript entry. Pass --bin <path to dist/index.js>.`);
    process.exit(2);
  }
  return join(dirname(shimPath), ...target.split("\\"));
}

// Resolved once: what argv[0] runs, and the arguments that select the CLI ahead of its own.
const ENTRY = /\.(c?js|mjs)$/i.test(BIN)
  ? { file: process.execPath, prefix: [BIN] }
  : /\.(cmd|bat)$/i.test(BIN)
    ? { file: process.execPath, prefix: [shimEntry(BIN)] }
    : { file: BIN, prefix: [] };

/**
 * Start the CLI binary synchronously, never through a shell: a .js entry (or the entry behind a
 * Windows .cmd shim) runs under this node, and any other binary (a POSIX `wave` symlink with its
 * shebang) is executed directly.
 */
function launch(cliArgs, options) {
  return spawnSync(ENTRY.file, [...ENTRY.prefix, ...cliArgs], { ...options, shell: false });
}

/**
 * Run the CLI. `withKey:false` removes WAVE_API_KEY so only the stored credential can be used.
 * `input` is written to the child's stdin: the only way this script hands the CLI a key other
 * than the environment, so the key never appears in a process's arguments.
 */
function wave(cliArgs, { withKey = true, cwd = home, input, extraEnv = {} } = {}) {
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    WAVE_CREDENTIAL_STORE: "file",
    WAVE_NO_TELEMETRY: "1",
    NO_COLOR: "1",
    ...extraEnv,
  };
  // Org/project selection from the caller's shell would change what is being tested: the smoke
  // checks the key's own organization and the default project.
  delete env.WAVE_ORG_ID;
  delete env.WAVE_PROJECT;
  if (!withKey) delete env.WAVE_API_KEY;
  // Exit 6 is the gateway's rate limit (429), not a connectivity verdict: back off and retry.
  for (let attempt = 0; ; attempt++) {
    const r = launch(cliArgs, { cwd, env, input, encoding: "utf-8", timeout: 60_000 });
    if (r.status === 6 && attempt < 3) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000 * (attempt + 1));
      continue;
    }
    return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }
}

function json(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function control(path) {
  // Bounded like the CLI runs: a stalled API fails the smoke instead of hanging it.
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const body = json(await res.text());
  return { status: res.status, body };
}

try {
  // 0. Known-served controls: if these fail the API is down, and nothing below means anything.
  const surface = await control("/v1/network/surface");
  const facilitator = await control("/v1/x402/facilitator/supported");
  const controlsUp = surface.status === 200 && facilitator.status === 200 && surface.body && facilitator.body;
  record("control GET /v1/network/surface + /v1/x402/facilitator/supported", !!controlsUp, `${surface.status}/${facilitator.status}`);
  if (!controlsUp) throw new Error("controls down; aborting");

  const version = wave(["--version"]);
  record("wave --version", version.code === 0, version.stdout.trim());

  // 1. WAVE_API_KEY path (CI / agents).
  const status = wave(["-o", "json", "status"]);
  const s = json(status.stdout);
  record(
    "status -o json: authenticated + API healthy, single JSON document",
    status.code === 0 && s?.authenticated === true && s?.apiHealthy === true && s?.apiEndpoint === BASE,
    `exit=${status.code} endpoint=${s?.apiEndpoint} latencyMs=${s?.apiLatencyMs}`,
  );

  const authStatus = wave(["-o", "json", "auth", "status"]);
  const a = json(authStatus.stdout);
  record("auth status: env key counts", authStatus.code === 0 && a?.authenticated === true && a?.source === "env", `exit=${authStatus.code} source=${a?.source}`);

  const who = wave(["-o", "json", "whoami"]);
  const w = json(who.stdout);
  const orgId = w?.organizationId;
  record(
    "whoami: GET /v1/me (or billing fallback) names the org",
    who.code === 0 && typeof orgId === "string" && orgId !== "N/A",
    `exit=${who.code} org=${orgId ? `${String(orgId).slice(0, 8)}…` : "none"} profile=${w?.profileUnavailable ?? "ok"}`,
  );

  const billing = wave(["-o", "json", "billing", "status"]);
  const b = json(billing.stdout);
  record("billing status: GET /v1/billing", billing.code === 0 && typeof b?.plan !== "undefined" && b?.organizationId === orgId, `exit=${billing.code} plan=${JSON.stringify(b?.plan ?? null).slice(0, 40)}`);

  const usage = wave(["-o", "json", "billing", "usage"]);
  const u = json(usage.stdout);
  record("billing usage: GET /v1/billing/usage", usage.code === 0 && u?.period && "usage" in (u ?? {}), `exit=${usage.code} period=${JSON.stringify(u?.period ?? null)}`);

  const overview = wave(["-o", "json", "analytics", "overview"]);
  const o = json(overview.stdout);
  record("analytics overview: GET /v1/analytics/overview", overview.code === 0 && o?.summary !== undefined, `exit=${overview.code} keys=${Object.keys(o ?? {}).join(",")}`);

  const hooks = wave(["-o", "json", "webhook-subscriptions", "list"]);
  const h = json(hooks.stdout);
  record("webhook-subscriptions list", hooks.code === 0 && Array.isArray(h?.subscriptions), `exit=${hooks.code} count=${h?.subscriptions?.length}`);

  // Served route, handler-level answer: an unknown agent is 404 UNKNOWN_AGENT, not ROUTE_NOT_MAPPED.
  const ident = wave(["-o", "json", "identity", "resolve", "smoke-unknown-agent"]);
  const ie = json(ident.stderr);
  record(
    "identity resolve: GET ?agent= reaches the handler (UNKNOWN_AGENT, not ROUTE_NOT_MAPPED)",
    ident.code === 4 && ie?.error?.code === "UNKNOWN_AGENT",
    `exit=${ident.code} code=${ie?.error?.code} req=${ie?.error?.request_id ?? ""}`,
  );

  // Unserved route: says so and exits 11 instead of a plain 404. If the route has since been
  // served, the command must print a real stream list instead (`stream list -o json` prints the
  // page's `data` array; an empty array is a valid answer). Any other JSON, or none, fails.
  const streams = wave(["-o", "json", "stream", "list"]);
  const se = json(streams.stderr);
  const unserved = streams.code === 11 && ["ROUTE_NOT_FOUND", "ROUTE_NOT_MAPPED"].includes(se?.error?.code);
  const servedList = streams.code === 0 && Array.isArray(json(streams.stdout));
  record(
    "stream list: ROUTE_NOT_FOUND/ROUTE_NOT_MAPPED reported as not served (exit 11), or a served stream array",
    unserved || servedList,
    `exit=${streams.code} code=${se?.error?.code ?? "none"} req=${se?.error?.request_id ?? ""}`,
  );

  // `wave api` uses the same exit-code contract as every command. Once served, the body must be
  // the paginated page the SDK reads ({ data: [...] }), not merely any 2xx.
  const rawStreams = wave(["-o", "json", "api", "GET", "/v1/streams"]);
  const rawNotServed = rawStreams.code === 11 && /ROUTE_NOT_(FOUND|MAPPED)/.test(rawStreams.stderr);
  const rawServed = rawStreams.code === 0 && Array.isArray(json(rawStreams.stdout)?.data);
  record(
    "api GET /v1/streams: exit 11 with the gateway's ROUTE_NOT_FOUND body (or, once served, a { data: [] } page)",
    rawNotServed || rawServed,
    `exit=${rawStreams.code}`,
  );

  const logs = wave(["-o", "json", "logs", "tail"]);
  record("logs tail: stops before sending (exit 11)", logs.code === 11, `exit=${logs.code}`);

  // Credentials never travel over plain http to a remote host (refused before any request).
  const insecure = wave(["-o", "json", "billing", "status"], { extraEnv: { WAVE_BASE_URL: "http://api.wave.online" } });
  record(
    "WAVE_BASE_URL=http://… (non-loopback) is refused, exit 9",
    insecure.code === 9 && json(insecure.stderr)?.error?.code === "CONFIG_ERROR",
    `exit=${insecure.code}`,
  );

  // 2. Stored-key path: `wave login --api-key-stdin` into the file store (the key goes over stdin,
  // never argv), then use it WITHOUT the env var.
  const login = wave(["login", "--api-key-stdin"], { withKey: false, input: `${KEY}\n` });
  record("login --api-key-stdin (alias) stores the key", login.code === 0, `exit=${login.code} ${login.stdout.trim().split("\n")[0]}`);

  const storedWho = wave(["-o", "json", "whoami"], { withKey: false });
  const sw = json(storedWho.stdout);
  record("whoami with the stored key only", storedWho.code === 0 && sw?.source === "stored" && sw?.organizationId === orgId, `exit=${storedWho.code} source=${sw?.source}`);

  const storedBilling = wave(["-o", "json", "billing", "status"], { withKey: false });
  record("billing status with the stored key only", storedBilling.code === 0 && json(storedBilling.stdout)?.organizationId === orgId, `exit=${storedBilling.code}`);

  const cfg = json(readFileSync(join(home, ".wave", "config.json"), "utf-8"));
  record("login wrote projects.default", cfg?.projects?.default?.baseUrl === BASE, `baseUrl=${cfg?.projects?.default?.baseUrl}`);

  const logout = wave(["logout"], { withKey: false });
  const after = wave(["-o", "json", "auth", "status"], { withKey: false });
  record(
    "logout removes it (auth status exits 2, AUTH_REQUIRED)",
    logout.code === 0 && after.code === 2 && json(after.stdout)?.authenticated === false,
    `logout=${logout.code} status=${after.code}`,
  );

  // 3. Packaging: init scaffolds a real project from the shipped templates.
  const init = wave(["init", "smoke-app", "--template", "blank", "--no-install"]);
  const pkgPath = join(home, "smoke-app", "package.json");
  const pkg = existsSync(pkgPath) ? json(readFileSync(pkgPath, "utf-8")) : null;
  record(
    "init --template blank: package.json present, depends on @wave-av/sdk",
    init.code === 0 && pkg?.name === "smoke-app" && !!pkg?.dependencies?.["@wave-av/sdk"],
    `exit=${init.code} deps=${Object.keys(pkg?.dependencies ?? {}).join(",")}`,
  );

  // 4. Optional: `wave auth login` (device flow) driven through the CLI itself. It starts one
  // ceremony on POST /v1/agent/auth/device (unauthenticated, never approved; it expires on its own),
  // prints the code, and polls /v1/agent/auth/token. Still polling when the timeout kills it = the
  // grant parsed and every poll answered authorization_pending. 1.0.10 exited at once with a 404.
  if (WITH_DEVICE) {
    const env = { ...process.env, HOME: home, USERPROFILE: home, WAVE_CREDENTIAL_STORE: "file", NO_COLOR: "1" };
    delete env.WAVE_API_KEY;
    const r = launch(["auth", "login", "--no-browser"], { cwd: home, env, encoding: "utf-8", timeout: 15_000 });
    const out = r.stdout ?? "";
    const verify = out.match(/https?:\/\/\S+/)?.[0] ?? "";
    record(
      "auth login (device flow): grant printed, still polling at timeout",
      r.signal === "SIGTERM" && out.includes("Enter this code") && verify.startsWith(BASE),
      `signal=${r.signal} exit=${r.status} verification_uri=${verify} stderr=${(r.stderr ?? "").trim().slice(0, 160)}`,
    );
  }
} catch (err) {
  record("smoke run", false, err instanceof Error ? err.message : String(err));
} finally {
  rmSync(home, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
