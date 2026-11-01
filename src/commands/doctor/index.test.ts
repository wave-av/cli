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
  getConfigPath: vi.fn(() => "~/.wave/config.json"),
}));
vi.mock("../../lib/auth/keychain.js", () => ({
  getApiKey: vi.fn(),
}));

import { loadConfig } from "../../lib/config/manager.js";
import { getApiKey } from "../../lib/auth/keychain.js";
import { KeychainTimeoutError } from "../../lib/errors.js";
import { registerDoctorCommands } from "./index.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-o, --output <format>", "", "json");
  program.option("--project <name>");
  registerDoctorCommands(program);
  return program;
}

type Check = { name: string; status: string; message: string; fix?: string };

/** Run doctor with -o json and return its checks. */
async function runDoctor(...args: string[]): Promise<Check[]> {
  const out: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(" ")));
  await buildProgram().parseAsync(["node", "wave", ...args, "doctor"]);
  return JSON.parse(out.join("\n")) as Check[];
}

describe("wave doctor: which credential it checks", () => {
  beforeEach(() => {
    process.exitCode = undefined;
    vi.mocked(getApiKey).mockReset();
    vi.stubEnv("WAVE_API_KEY", "");
    vi.stubEnv("WAVE_PROJECT", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
  });

  it("with WAVE_API_KEY set, never reads the keychain, and needs no saved project", async () => {
    vi.stubEnv("WAVE_API_KEY", "wv_fake_envkeyabcdefgh");
    vi.mocked(loadConfig).mockResolvedValue(getDefaultConfig());
    const checks = await runDoctor();
    expect(getApiKey).not.toHaveBeenCalled();
    expect(checks.find((c) => c.name === "Auth")?.status).toBe("pass");
    expect(checks.find((c) => c.name === "Projects")).toMatchObject({ status: "pass", message: expect.stringMatching(/not needed/) });
    expect(process.exitCode).toBeUndefined();
  });

  it("checks the project --project / WAVE_PROJECT select, not always currentProject", async () => {
    vi.mocked(loadConfig).mockResolvedValue(getDefaultConfig());
    vi.mocked(getApiKey).mockImplementation(async (p: string) => (p === "production" ? "wv_fake_prodkey1234" : null));
    const flag = await runDoctor("--project", "production");
    expect(getApiKey).toHaveBeenLastCalledWith("production");
    expect(flag.find((c) => c.name === "Auth")?.status).toBe("pass");

    vi.stubEnv("WAVE_PROJECT", "staging");
    const env = await runDoctor();
    expect(getApiKey).toHaveBeenLastCalledWith("staging");
    expect(env.find((c) => c.name === "Auth")).toMatchObject({ status: "fail", message: expect.stringMatching(/"staging"/) });
  });

  it("reports a broken credential store as the Auth check and still runs every other check", async () => {
    // Review finding (PR #86): keytar that loads without its full API is refused loudly, and that
    // throw used to abort doctor before it printed anything.
    vi.mocked(loadConfig).mockResolvedValue(getDefaultConfig());
    vi.mocked(getApiKey).mockRejectedValue(
      new Error("The installed keytar module does not provide setPassword/getPassword/deletePassword/findCredentials"),
    );
    const checks = await runDoctor();
    expect(checks.map((c) => c.name)).toEqual(["Node.js", "Config", "Auth", "Projects", "Environment", "Telemetry"]);
    expect(checks.find((c) => c.name === "Auth")).toMatchObject({
      status: "fail",
      message: expect.stringMatching(/^Credential store unusable: The installed keytar module/),
      fix: expect.stringMatching(/WAVE_API_KEY.*WAVE_CREDENTIAL_STORE=file/),
    });
    expect(process.exitCode).toBe(1);
  });

  it("still ends the process through wrapCommand when the keychain times out", async () => {
    vi.mocked(loadConfig).mockResolvedValue(getDefaultConfig());
    vi.mocked(getApiKey).mockRejectedValue(new KeychainTimeoutError("The OS keychain did not answer within 60s (read)."));
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string, done?: () => void) => {
      stderr.push(String(chunk));
      done?.();
      return true;
    }) as typeof process.stderr.write);
    const kill = vi.spyOn(process, "kill").mockImplementation((() => true) as typeof process.kill);
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(" ")));
    await buildProgram().parseAsync(["node", "wave", "doctor"]);
    expect(stderr.join("")).toMatch(/keychain did not answer/);
    expect(kill).toHaveBeenCalledWith(process.pid, "SIGKILL");
    expect(out).toEqual([]); // no half-finished report on stdout
  });

  it("reports a config file it refuses to use as a failed check instead of crashing", async () => {
    vi.mocked(loadConfig).mockRejectedValue(new Error("~/.wave/config.json is not valid JSON"));
    vi.mocked(getApiKey).mockResolvedValue("wv_fake_storedkey123");
    const checks = await runDoctor();
    expect(checks.find((c) => c.name === "Config")).toMatchObject({
      status: "fail",
      message: expect.stringMatching(/not valid JSON/),
      fix: expect.stringMatching(/config\.json/),
    });
    expect(process.exitCode).toBe(1);
  });
});

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

    const fixtureValue = "wv_fake_abcdefghijklmnop";
    const config = getDefaultConfig();
    config.projects["default"] = { organizationId: "org_1", organizationName: "Acme" };
    vi.mocked(loadConfig).mockResolvedValue(config);
    vi.mocked(getApiKey).mockResolvedValue(fixtureValue);
    delete process.env["WAVE_API_KEY"];

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "doctor"]);

    const output = logs.join("\n");
    expect(output).not.toContain(fixtureValue);
    expect(output).not.toContain(fixtureValue.slice(0, 12));
    expect(output).not.toContain("wv_fake");
    // Presence is still reported, masked.
    expect(output).toContain("****");
  });

  it("never prints a prefix of the WAVE_API_KEY env var", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const fixtureValue = "wv_fake_envkeyabcdefgh";
    const config = getDefaultConfig();
    config.projects["default"] = { organizationId: "org_1", organizationName: "Acme" };
    vi.mocked(loadConfig).mockResolvedValue(config);
    vi.mocked(getApiKey).mockResolvedValue(null);
    process.env["WAVE_API_KEY"] = fixtureValue;

    try {
      const program = buildProgram();
      await program.parseAsync(["node", "wave", "doctor"]);

      const output = logs.join("\n");
      expect(output).not.toContain(fixtureValue);
      expect(output).not.toContain(fixtureValue.slice(0, 12));
      expect(output).toContain("****");
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
