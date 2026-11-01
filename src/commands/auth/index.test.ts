import { Readable } from "node:stream";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig } from "../../lib/config/schema.js";

/**
 * Regression tests for `wave auth status` (used to always exit 0, even unauthenticated) and
 * `wave whoami` (already exited 1 correctly — "keep the good copy" — but defaulted to the
 * wave.online marketing host instead of api.wave.online for its API call).
 */

vi.mock("../../lib/config/manager.js", () => ({
  loadConfig: vi.fn(),
  updateConfig: vi.fn(),
}));
vi.mock("../../lib/auth/keychain.js", () => ({
  getApiKey: vi.fn(),
  storeApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  deleteAllKeys: vi.fn(),
  getRefreshToken: vi.fn(),
  storeRefreshToken: vi.fn(),
}));

import { loadConfig } from "../../lib/config/manager.js";
import { getApiKey } from "../../lib/auth/keychain.js";
import { EXIT_CODES } from "../../lib/exit-codes.js";
import { lookupIdentity, readApiKeyFromStdin, registerAuthCommands } from "./index.js";

// These tests exercise the stored-key path: a WAVE_API_KEY in the developer's shell (which every
// command now honors first) must not leak in and flip "unauthenticated" cases to authenticated.
beforeEach(() => {
  vi.stubEnv("WAVE_API_KEY", "");
  vi.stubEnv("WAVE_BASE_URL", "");
  vi.stubEnv("WAVE_PROJECT", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-o, --output <format>", "", "json");
  registerAuthCommands(program);
  return program;
}

describe("wave auth status", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.exitCode = undefined;
    vi.mocked(loadConfig).mockResolvedValue(getDefaultConfig());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("exits AUTH_REQUIRED (2) when not authenticated (previously always exited 0)", async () => {
    vi.mocked(getApiKey).mockResolvedValue(null);
    const program = buildProgram();
    await program.parseAsync(["node", "wave", "auth", "status"]);

    expect(process.exitCode).toBe(EXIT_CODES.AUTH_REQUIRED);
  });

  it("does not set a failing exit code when authenticated", async () => {
    vi.mocked(getApiKey).mockResolvedValue("wv_test_key");
    const program = buildProgram();
    await program.parseAsync(["node", "wave", "auth", "status"]);

    expect(process.exitCode).toBeUndefined();
  });
});

describe("wave whoami", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // whoami calls process.exit(1) directly (not process.exitCode) on failure — never let a
    // test actually terminate the vitest worker.
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: "Ada", email: "ada@wave.online" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(loadConfig).mockResolvedValue(getDefaultConfig());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("exits non-zero (AUTH_REQUIRED) immediately when no API key is stored, without calling the API", async () => {
    vi.mocked(getApiKey).mockResolvedValue(null);
    const program = buildProgram();
    await program.parseAsync(["node", "wave", "whoami"]);

    expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.AUTH_REQUIRED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls GET /v1/me, not the unserved /api/v1/me", async () => {
    vi.mocked(getApiKey).mockResolvedValue("wv_test_key");
    const program = buildProgram();
    await program.parseAsync(["node", "wave", "whoami"]);

    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://api.wave.online/v1/me");
  });

  it("calls the API host (api.wave.online), not the wave.online marketing site", async () => {
    vi.mocked(getApiKey).mockResolvedValue("wv_test_key");
    const program = buildProgram();
    await program.parseAsync(["node", "wave", "whoami"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String((fetchMock.mock.calls[0] as [unknown, unknown])[0]);
    expect(url).toContain("https://api.wave.online");
    expect(url).not.toContain("https://wave.online/");
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe("whoami: organization lookup", () => {
  const creds = { apiKey: "k", source: "env" as const, project: "default", baseUrl: "https://api.wave.online" };
  const forbidden = (scope: string) =>
    new Response(JSON.stringify({ error: { code: "SCOPE_INSUFFICIENT", message: `requires scope: ${scope}` } }), {
      status: 403,
    });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says so explicitly when the key can read neither /v1/me nor /v1/billing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(forbidden("me:read")).mockResolvedValueOnce(forbidden("billing:read")));
    const identity = await lookupIdentity(creds, getDefaultConfig());
    expect(identity.organizationId).toBe("N/A");
    expect(identity.organizationUnavailable).toMatch(/neither GET \/v1\/me \(me:read\) nor GET \/v1\/billing \(billing:read\)/);
  });

  it("propagates a billing outage instead of reporting a successful identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(forbidden("me:read"))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "UPSTREAM", message: "down" } }), { status: 503 })),
    );
    await expect(lookupIdentity(creds, getDefaultConfig())).rejects.toMatchObject({ statusCode: 503 });
  });

  it("reports the key's own org, not the one --org/WAVE_ORG_ID asked for", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(forbidden("me:read")).mockResolvedValueOnce(forbidden("billing:read")));
    const identity = await lookupIdentity({ ...creds, organizationId: "org_requested" }, getDefaultConfig());
    expect(identity.organizationId).toBe("N/A");
  });
});

describe("whoami: human output from API-controlled text", () => {
  it("strips terminal escape sequences from profile fields", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.join(" ")));
    vi.mocked(loadConfig).mockResolvedValue(getDefaultConfig());
    vi.mocked(getApiKey).mockResolvedValue("wv_test_key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ name: "Ada\u001b]0;pwned\u0007\u001b[2J", email: "a@b.test", organizationId: "org_1" }), {
          status: 200,
        }),
      ),
    );
    try {
      const program = new Command();
      program.exitOverride();
      program.option("-o, --output <format>");
      registerAuthCommands(program);
      await program.parseAsync(["node", "wave", "whoami"]);
      const text = lines.join("\n");
      expect(text).toContain("Ada]0;pwned[2J");
      expect(text).not.toContain("\u001b]0;");
      expect(text).not.toContain("\u0007");
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});

describe("auth login --api-key-stdin", () => {
  it("reads one key from a pipe, trimmed", async () => {
    expect(await readApiKeyFromStdin(Readable.from(["wave_test_piped\n"]))).toBe("wave_test_piped");
  });

  it("refuses a terminal, empty input, and more than one token", async () => {
    const tty = Object.assign(Readable.from([]), { isTTY: true });
    await expect(readApiKeyFromStdin(tty)).rejects.toThrow(/reads the key from a pipe/);
    await expect(readApiKeyFromStdin(Readable.from(["  \n"]))).rejects.toThrow(/stdin was empty/);
    await expect(readApiKeyFromStdin(Readable.from(["key1 key2\n"]))).rejects.toThrow(/single API key/);
  });
});
