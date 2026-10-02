import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WaveError } from "@wave-av/sdk";
import { getDefaultConfig } from "../lib/config/schema.js";
import { EXIT_CODES } from "../lib/exit-codes.js";

/**
 * Connectivity regressions from the 1.0.10 probe, driven through the real command tree
 * (createProgram) with the network stubbed. Every assertion pins either the exact URL a command
 * sends or proves that a command for an unserved route sends nothing at all.
 */

vi.mock("../lib/config/manager.js", () => ({
  loadConfig: vi.fn(),
  updateConfig: vi.fn(),
  saveConfig: vi.fn(),
  getConfigPath: vi.fn(() => "/nonexistent/.wave/config.json"),
  getConfigDir: vi.fn(() => "/nonexistent/.wave"),
}));
vi.mock("../lib/auth/keychain.js", () => ({
  getApiKey: vi.fn(),
  storeApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  deleteAllKeys: vi.fn(),
  getRefreshToken: vi.fn(),
  storeRefreshToken: vi.fn(),
  credentialBackend: vi.fn(async () => "file"),
}));

import { loadConfig, updateConfig } from "../lib/config/manager.js";
import { getApiKey, storeApiKey } from "../lib/auth/keychain.js";
import { createProgram } from "../cli.js";
import { discoverOrganizationId } from "./link/index.js";
import { lookupIdentity } from "./auth/index.js";

class ExitSignal extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

let fetchMock: ReturnType<typeof vi.fn>;
let stdout: string[];
let stderr: string[];

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** Run `wave <args>`; resolves to the exit code (0 when the action returned normally). */
async function wave(...args: string[]): Promise<number> {
  const program = createProgram();
  program.exitOverride();
  try {
    await program.parseAsync(["node", "wave", ...args]);
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (err) {
    if (err instanceof ExitSignal) return err.code ?? 0;
    throw err;
  }
}

function calledUrls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  vi.clearAllMocks(); // call history of the module mocks, so each test sees only its own calls
  stdout = [];
  stderr = [];
  process.exitCode = undefined;
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void stdout.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void stderr.push(a.join(" ")));
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitSignal(code);
  }) as never);
  fetchMock = vi.fn(async () => reply(200, {}));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("WAVE_API_KEY", "wave_test_env_key");
  vi.stubEnv("WAVE_BASE_URL", "");
  vi.stubEnv("WAVE_PROJECT", "");
  vi.stubEnv("WAVE_ORG_ID", "");
  vi.mocked(loadConfig).mockResolvedValue(getDefaultConfig());
  vi.mocked(updateConfig).mockImplementation(async (fn) => fn(getDefaultConfig()));
  vi.mocked(getApiKey).mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

describe("login", () => {
  it("`wave login` exists as an alias (1.0.10: unknown command 'login' (Did you mean logs?))", async () => {
    vi.stubEnv("WAVE_API_KEY", "");
    expect(await wave("login", "--api-key", "wave_test_new")).toBe(0);
    expect(storeApiKey).toHaveBeenCalledWith("default", "wave_test_new");
  });

  it("`auth login --api-key` writes the project entry every API command reads", async () => {
    vi.stubEnv("WAVE_API_KEY", "");
    expect(await wave("auth", "login", "--api-key", "wave_test_new")).toBe(0);
    const updater = vi.mocked(updateConfig).mock.calls[0]![0];
    const next = updater(getDefaultConfig());
    expect(next.projects["default"]).toMatchObject({ baseUrl: "https://api.wave.online" });
    expect(next.currentProject).toBe("default");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an unauthenticated SDK command exits 2 (AUTH_REQUIRED) before any request", async () => {
    vi.stubEnv("WAVE_API_KEY", "");
    expect(await wave("stream", "list")).toBe(EXIT_CODES.AUTH_REQUIRED);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stderr.join("\n")).toMatch(/wave auth login/);
  });
});

describe("WAVE_API_KEY is honored everywhere (1.0.10: 'Not authenticated' from half the CLI)", () => {
  it("auth status reports authenticated from the env key", async () => {
    expect(await wave("-o", "json", "auth", "status")).toBe(0);
    const status = JSON.parse(stdout.join("\n")) as { authenticated: boolean; source: string; apiEndpoint: string };
    expect(status).toMatchObject({ authenticated: true, source: "env", apiEndpoint: "https://api.wave.online" });
  });

  it("whoami -o json prints exactly one JSON document from GET /v1/me", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { name: "Ada", email: "ada@example.test", organizationId: "org_1" }));
    expect(await wave("-o", "json", "whoami")).toBe(0);
    expect(calledUrls()).toEqual(["https://api.wave.online/v1/me"]);
    const doc = JSON.parse(stdout.join("\n")) as Record<string, unknown>;
    expect(doc).toMatchObject({ authenticated: true, source: "env", name: "Ada", organizationId: "org_1" });
  });
});

describe("served routes on the API host", () => {
  it("billing status -> GET /v1/billing (1.0.10: https://wave.online/api/billing/status, 404)", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { organizationId: "org_1", plan: "free" }));
    expect(await wave("-o", "json", "billing", "status")).toBe(0);
    expect(calledUrls()).toEqual(["https://api.wave.online/v1/billing"]);
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer wave_test_env_key");
  });

  it("billing usage --period previous -> GET /v1/billing/usage?from&to", async () => {
    expect(await wave("-o", "json", "billing", "usage", "--period", "previous")).toBe(0);
    const url = new URL(calledUrls()[0]!);
    expect(url.origin + url.pathname).toBe("https://api.wave.online/v1/billing/usage");
    expect(url.searchParams.get("from")).toMatch(/^\d{4}-\d{2}-01$/);
    expect(url.searchParams.get("to")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("analytics overview|engagement|top-content -> the served GET /v1/analytics/* routes", async () => {
    await wave("-o", "json", "analytics", "overview");
    await wave("-o", "json", "analytics", "engagement");
    await wave("-o", "json", "analytics", "top-content", "--limit", "5");
    expect(calledUrls()).toEqual([
      "https://api.wave.online/v1/analytics/overview",
      "https://api.wave.online/v1/analytics/engagement",
      "https://api.wave.online/v1/analytics/top-content?limit=5",
    ]);
  });

  it("identity resolve -> GET /v1/identity/resolve?agent= (1.0.10 sent POST, ROUTE_NOT_MAPPED)", async () => {
    expect(await wave("-o", "json", "identity", "resolve", "agent_42")).toBe(0);
    expect(calledUrls()).toEqual(["https://api.wave.online/v1/identity/resolve?agent=agent_42"]);
    expect((fetchMock.mock.calls[0] as [URL, RequestInit])[1].method).toBe("GET");
  });

  it("webhook-subscriptions list errors honor -o json (1.0.10 printed '✗ 404 ...')", async () => {
    fetchMock.mockResolvedValueOnce(reply(403, { error: { code: "SCOPE_INSUFFICIENT", message: "requires scope: webhooks:read" } }));
    // formatCLIError reads -o json from process.argv (errors are formatted outside commander).
    const argv = process.argv;
    process.argv = ["node", "wave", "-o", "json", "webhook-subscriptions", "list"];
    try {
      expect(await wave("-o", "json", "webhook-subscriptions", "list")).toBe(EXIT_CODES.PERMISSION_DENIED);
    } finally {
      process.argv = argv;
    }
    const err = JSON.parse(stderr.join("\n")) as { error: { code: string } };
    expect(err.error.code).toBe("SCOPE_INSUFFICIENT");
  });
});

describe("commands for unserved routes stop before sending anything (exit 11)", () => {
  const cases: string[][] = [
    ["billing", "invoices"],
    ["billing", "limits"],
    ["billing", "portal"],
    ["billing", "upgrade"],
    ["logs", "tail"],
    ["listen"],
    ["trigger", "stream.started"],
    ["dev"],
    ["admin", "jobs", "list"],
    ["mesh", "status"],
    ["mesh", "regions"],
  ];
  for (const args of cases) {
    it(`wave ${args.join(" ")}`, async () => {
      expect(await wave(...args)).toBe(EXIT_CODES.NOT_IMPLEMENTED);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }
});

describe("link: org discovery on served routes", () => {
  const creds = { apiKey: "k", source: "env" as const, project: "default", baseUrl: "https://api.wave.online" };

  it("moves past a 403 to the next served route", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(403, { error: { code: "SCOPE_INSUFFICIENT", message: "requires scope: billing:read" } }))
      .mockResolvedValueOnce(reply(200, { organizationId: "org_from_analytics" }));
    expect(await discoverOrganizationId(creds)).toBe("org_from_analytics");
    expect(calledUrls()).toEqual([
      "https://api.wave.online/v1/billing",
      "https://api.wave.online/v1/analytics/overview",
    ]);
    expect(calledUrls().some((u) => u.includes("/v1/organizations") || u.includes("/v1/projects"))).toBe(false);
  });

  it("propagates a real failure instead of guessing", async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { error: { code: "UNAUTHORIZED", message: "invalid key" } }));
    await expect(discoverOrganizationId(creds)).rejects.toBeInstanceOf(WaveError);
  });

  it("exits AUTH_REQUIRED when unauthenticated (1.0.10 printed 'Not authenticated' and exited 0)", async () => {
    vi.stubEnv("WAVE_API_KEY", "");
    expect(await wave("link")).toBe(EXIT_CODES.AUTH_REQUIRED);
  });
});

describe("link: the command end to end", () => {
  let work: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "wave-cli-link-"));
    vi.spyOn(process, "cwd").mockReturnValue(work);
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it("records the key's org in .wave/project.json, .gitignore and the CLI project entry", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { organizationId: "org_live", plan: "free" }));
    expect(await wave("link", "--name", "site")).toBe(0);

    const linked = JSON.parse(readFileSync(join(work, ".wave", "project.json"), "utf-8")) as Record<string, string>;
    expect(linked).toMatchObject({ organizationId: "org_live", projectName: "site" });
    expect(readFileSync(join(work, ".gitignore"), "utf-8")).toContain(".wave/");
    const updater = vi.mocked(updateConfig).mock.calls[0]![0];
    expect(updater(getDefaultConfig()).projects["default"]).toMatchObject({ organizationId: "org_live" });
  });

  it("asks without the stale saved org header, so a new key can be relinked", async () => {
    vi.stubEnv("WAVE_ORG_ID", "org_stale");
    fetchMock.mockResolvedValueOnce(reply(200, { organizationId: "org_new" }));
    expect(await wave("link")).toBe(0);
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>)["x-organization-id"]).toBeUndefined();
  });

  it("fails (and writes nothing) when no served route will name the org", async () => {
    const forbidden = () => reply(403, { error: { code: "SCOPE_INSUFFICIENT", message: "forbidden" } });
    fetchMock.mockResolvedValueOnce(forbidden()).mockResolvedValueOnce(forbidden()).mockResolvedValueOnce(forbidden());
    expect(await wave("link")).toBe(EXIT_CODES.GENERAL_ERROR);
    expect(stderr.join("\n")).toMatch(/Could not determine your organization/);
    expect(existsSync(join(work, ".wave"))).toBe(false);
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("fails on --org when the key belongs to another org", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { organizationId: "org_live" }));
    expect(await wave("link", "--org", "org_other")).toBe(EXIT_CODES.GENERAL_ERROR);
    expect(stderr.join("\n")).toMatch(/belongs to organization org_live, not org_other/);
    expect(existsSync(join(work, ".wave"))).toBe(false);
  });
});

describe("--org on raw gateway routes", () => {
  it("is sent as x-organization-id, ahead of WAVE_ORG_ID", async () => {
    vi.stubEnv("WAVE_ORG_ID", "org_env");
    await wave("-o", "json", "billing", "status");
    await wave("--org", "org_flag", "-o", "json", "billing", "status");
    const headers = fetchMock.mock.calls.map((c) => ((c as [URL, RequestInit])[1].headers as Record<string, string>)["x-organization-id"]);
    expect(headers).toEqual(["org_env", "org_flag"]);
  });
});

describe("wave api: exit codes match every other command", () => {
  it("ROUTE_NOT_FOUND exits 11 and still shows the response", async () => {
    fetchMock.mockResolvedValueOnce(reply(404, { error: { code: "ROUTE_NOT_FOUND", message: "No WAVE capability is served at this path." } }));
    expect(await wave("api", "GET", "/v1/streams")).toBe(EXIT_CODES.NOT_IMPLEMENTED);
    expect(stderr.join("\n")).toMatch(/ROUTE_NOT_FOUND/);
  });

  it("401 exits 2, 403 exits 7, a flat 402 body keeps its code", async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { error: { code: "UNAUTHORIZED", message: "bad key" } }));
    expect(await wave("api", "GET", "/v1/billing")).toBe(EXIT_CODES.AUTH_REQUIRED);
    fetchMock.mockResolvedValueOnce(reply(403, { error: { code: "SCOPE_INSUFFICIENT", message: "nope" } }));
    expect(await wave("api", "GET", "/v1/me")).toBe(EXIT_CODES.PERMISSION_DENIED);
    fetchMock.mockResolvedValueOnce(reply(402, { error: "spend_cap_exceeded", code: "SPEND_CAP_TIER_BLOCKED", message: "Add a payment method" }));
    expect(await wave("api", "GET", "/v1/clips")).toBe(EXIT_CODES.GENERAL_ERROR);
    expect(stderr.join("\n")).toMatch(/SPEND_CAP_TIER_BLOCKED/);
  });
});

describe("auth login: credential input and re-login", () => {
  it("--api-key-stdin stores the piped key (never in argv)", async () => {
    vi.stubEnv("WAVE_API_KEY", "");
    vi.spyOn(process, "stdin", "get").mockReturnValue(Readable.from(["wave_test_piped\n"]) as unknown as typeof process.stdin);
    expect(await wave("auth", "login", "--api-key-stdin")).toBe(0);
    expect(storeApiKey).toHaveBeenCalledWith("default", "wave_test_piped");
  });

  it("rejects --api-key together with --api-key-stdin", async () => {
    vi.stubEnv("WAVE_API_KEY", "");
    expect(await wave("auth", "login", "--api-key", "a", "--api-key-stdin")).toBe(EXIT_CODES.GENERAL_ERROR);
    expect(storeApiKey).not.toHaveBeenCalled();
  });

  it("a new login drops the cached organization (the new key may belong to another org)", async () => {
    vi.stubEnv("WAVE_API_KEY", "");
    expect(await wave("auth", "login", "--api-key", "wave_test_rotated")).toBe(0);
    const updater = vi.mocked(updateConfig).mock.calls[0]![0];
    const before = getDefaultConfig();
    before.projects["default"] = { organizationId: "org_old", organizationName: "Old", region: "us" };
    const after = updater(before).projects["default"]!;
    expect(after.organizationId).toBeUndefined();
    expect(after.organizationName).toBeUndefined();
    expect(after).toMatchObject({ region: "us", baseUrl: "https://api.wave.online" });
  });
});

describe("API base URL: credentials only over TLS", () => {
  it("refuses a non-https WAVE_BASE_URL before sending anything (exit 9)", async () => {
    vi.stubEnv("WAVE_BASE_URL", "http://api.example.test");
    expect(await wave("billing", "status")).toBe(EXIT_CODES.CONFIG_ERROR);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stderr.join("\n")).toMatch(/must use https:\/\//);
  });

  it("allows http:// for a gateway on localhost", async () => {
    vi.stubEnv("WAVE_BASE_URL", "http://localhost:8787");
    expect(await wave("-o", "json", "billing", "status")).toBe(0);
    expect(calledUrls()).toEqual(["http://localhost:8787/v1/billing"]);
  });
});

describe("whoami: key without me:read", () => {
  it("falls back to GET /v1/billing for the organization and says why the profile is missing", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(403, { error: { code: "SCOPE_INSUFFICIENT", message: "requires scope: me:read" } }))
      .mockResolvedValueOnce(reply(200, { organizationId: "org_billing", plan: "free" }));
    const identity = await lookupIdentity(
      { apiKey: "k", source: "env", project: "default", baseUrl: "https://api.wave.online" },
      getDefaultConfig(),
    );
    expect(identity).toMatchObject({
      authenticated: true,
      organizationId: "org_billing",
      profileUnavailable: "requires scope: me:read",
    });
  });

  it("a 401 is an error, not an identity", async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { error: { code: "UNAUTHORIZED", message: "invalid key" } }));
    expect(await wave("whoami")).toBe(EXIT_CODES.AUTH_REQUIRED);
  });
});
