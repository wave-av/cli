import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig } from "../../lib/config/schema.js";

/**
 * Regression tests for `wave status`:
 *  1. It used to health-check https://wave.online (the marketing site) instead of
 *     https://api.wave.online (the actual API), and hit /api/health instead of /health.
 *  2. It always exited 0, even when unauthenticated or the API was unreachable.
 */

vi.mock("../../lib/config/manager.js", () => ({
  loadConfig: vi.fn(),
}));
vi.mock("../../lib/auth/keychain.js", () => ({
  getApiKey: vi.fn(),
}));

import { loadConfig } from "../../lib/config/manager.js";
import { getApiKey } from "../../lib/auth/keychain.js";
import { registerStatusCommands } from "./index.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-o, --output <format>", "", "json");
  registerStatusCommands(program);
  return program;
}

describe("wave status", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.exitCode = undefined;
    fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(loadConfig).mockResolvedValue(getDefaultConfig());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  it("health-checks the API host (api.wave.online), not the marketing site", async () => {
    vi.mocked(getApiKey).mockResolvedValue("wv_test_key");
    const program = buildProgram();
    await program.parseAsync(["node", "wave", "status"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, unknown];
    expect(url).toBe("https://api.wave.online/health");
  });

  it("exits non-zero when not authenticated", async () => {
    vi.mocked(getApiKey).mockResolvedValue(null);
    const program = buildProgram();
    await program.parseAsync(["node", "wave", "status"]);

    expect(process.exitCode).toBe(1);
  });

  it("exits non-zero when the API is unreachable, even if authenticated", async () => {
    vi.mocked(getApiKey).mockResolvedValue("wv_test_key");
    fetchMock.mockRejectedValue(new Error("network down"));
    const program = buildProgram();
    await program.parseAsync(["node", "wave", "status"]);

    expect(process.exitCode).toBe(1);
  });

  it("does not set a failing exit code when authenticated and the API is healthy", async () => {
    vi.mocked(getApiKey).mockResolvedValue("wv_test_key");
    const program = buildProgram();
    await program.parseAsync(["node", "wave", "status"]);

    expect(process.exitCode).toBeUndefined();
  });
});
