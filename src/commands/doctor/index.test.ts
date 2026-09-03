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
