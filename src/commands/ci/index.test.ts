import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCiCommands } from "./index.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-o, --output <format>", "", "json");
  registerCiCommands(program);
  return program;
}

describe("wave ci", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.WAVE_CI_GATEWAY_SECRET = "test-secret";
    delete process.env.WAVE_CI_BASE;
    fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.WAVE_CI_GATEWAY_SECRET;
  });

  it("status hits the gateway with the trust secret", async () => {
    await buildProgram().parseAsync(["ci", "status"], { from: "user" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ci.wave.online/v1/ci/status");
    expect((init.headers as Record<string, string>)["x-wave-gateway-secret"]).toBe("test-secret");
  });

  it("dispatch posts repo/workflow/ref", async () => {
    await buildProgram().parseAsync(
      ["ci", "dispatch", "--repo", "wave-av/cli", "--workflow", "smoke-install.yml", "--ref", "main"],
      { from: "user" },
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ci.wave.online/v1/ci/dispatch");
    expect(JSON.parse(init.body as string)).toMatchObject({ repo: "wave-av/cli", workflow: "smoke-install.yml", ref: "main" });
  });

  it("rwx-dispatch posts key/ref", async () => {
    await buildProgram().parseAsync(["ci", "rwx-dispatch", "--key", "deploy", "--ref", "main"], { from: "user" });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ci.wave.online/v1/ci/rwx/dispatch");
  });

  it("captain-suites hits the suites route", async () => {
    await buildProgram().parseAsync(["ci", "captain-suites"], { from: "user" });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ci.wave.online/v1/ci/captain/suites");
  });

  it("refuses without the gateway secret", async () => {
    delete process.env.WAVE_CI_GATEWAY_SECRET;
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await buildProgram().parseAsync(["ci", "status"], { from: "user" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("surfaces gateway errors", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "CI_AUTH_REQUIRED", message: "nope" } }), { status: 401 }),
    );
    const err = vi.mocked(console.error).mock.calls;
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await buildProgram().parseAsync(["ci", "status"], { from: "user" });
    expect(exit).toHaveBeenCalledWith(1);
    expect(err.map((c) => String(c[0])).join(" ")).toMatch(/CI_AUTH_REQUIRED/);
  });
});
