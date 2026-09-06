import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig } from "../../lib/config/schema.js";

/**
 * Regression test: `wave doctor` used to exit 0 unconditionally, even when a check (e.g. no
 * stored API key) failed. Scripts/agents parsing the exit code had no way to detect a failing
 * setup without scraping colored text.
 */

vi.mock("../../lib/config/manager.js", () => ({
  loadConfig: vi.fn(),
}));
vi.mock("../../lib/auth/keychain.js", () => ({
  getApiKey: vi.fn(),
}));

import { loadConfig } from "../../lib/config/manager.js";
import { getApiKey } from "../../lib/auth/keychain.js";
import { registerDoctorCommands } from "./index.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-o, --output <format>", "", "json");
  registerDoctorCommands(program);
  return program;
}

describe("wave doctor exit codes", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("exits non-zero when no API key is found (a real failing check)", async () => {
    vi.mocked(loadConfig).mockResolvedValue(getDefaultConfig());
    vi.mocked(getApiKey).mockResolvedValue(null);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "doctor"]);

    expect(process.exitCode).toBe(1);
  });

  it("never prints a prefix of a stored API key (CodeQL js/clear-text-logging)", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const secret = "wv_live_abcdefghijklmnop";
    const config = getDefaultConfig();
    config.projects["default"] = { organizationId: "org_1", organizationName: "Acme" };
    vi.mocked(loadConfig).mockResolvedValue(config);
    vi.mocked(getApiKey).mockResolvedValue(secret);
    delete process.env["WAVE_API_KEY"];

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "doctor"]);

    const output = logs.join("\n");
    expect(output).not.toContain(secret);
    expect(output).not.toContain(secret.slice(0, 12));
    expect(output).not.toContain("wv_live");
    // Presence is still reported, masked.
    expect(output).toContain("****mnop");
  });

  it("never prints a prefix of the WAVE_API_KEY env var", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const secret = "wv_live_envkeyabcdefgh";
    const config = getDefaultConfig();
    config.projects["default"] = { organizationId: "org_1", organizationName: "Acme" };
    vi.mocked(loadConfig).mockResolvedValue(config);
    vi.mocked(getApiKey).mockResolvedValue(null);
    process.env["WAVE_API_KEY"] = secret;

    try {
      const program = buildProgram();
      await program.parseAsync(["node", "wave", "doctor"]);

      const output = logs.join("\n");
      expect(output).not.toContain(secret);
      expect(output).not.toContain(secret.slice(0, 12));
      expect(output).toContain("****efgh");
    } finally {
      delete process.env["WAVE_API_KEY"];
    }
  });

  it("does not set a failing exit code when every check passes", async () => {
    const config = getDefaultConfig();
    config.projects["default"] = {
      organizationId: "org_1",
      organizationName: "Acme",
    };
    vi.mocked(loadConfig).mockResolvedValue(config);
    vi.mocked(getApiKey).mockResolvedValue("wv_test_key");

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "doctor"]);

    expect(process.exitCode).toBeUndefined();
  });
});
