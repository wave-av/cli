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
import { registerAuthCommands } from "./index.js";

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

  it("exits non-zero when not authenticated (previously always exited 0)", async () => {
    vi.mocked(getApiKey).mockResolvedValue(null);
    const program = buildProgram();
    await program.parseAsync(["node", "wave", "auth", "status"]);

    expect(process.exitCode).toBe(1);
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
