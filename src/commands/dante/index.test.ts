import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api-client.js", () => ({
  getClient: vi.fn(),
}));

import { getClient } from "../../lib/api-client.js";
import { registerDanteCommands } from "./index.js";

function fakeClient(postMock: ReturnType<typeof vi.fn>) {
  return { client: { get: vi.fn(), post: postMock, put: vi.fn(), patch: vi.fn(), delete: vi.fn(), on: vi.fn() } };
}

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-o, --output <format>", "", "json");
  registerDanteCommands(program);
  return program;
}

describe("wave dante observe", () => {
  beforeEach(() => {
    vi.mocked(getClient).mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls POST /v1/dante/observe (through the gateway, not the spoke directly)", async () => {
    const postMock = vi.fn().mockResolvedValue({ node: "console-1", channels: [] });
    vi.mocked(getClient).mockResolvedValue(fakeClient(postMock) as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "dante", "observe", "--node", "console-1"]);

    expect(postMock).toHaveBeenCalledWith("/v1/dante/observe", { node: "console-1" });
  });

  it("calls POST /v1/dante/observe with no body when --node is omitted", async () => {
    const postMock = vi.fn().mockResolvedValue({ channels: [] });
    vi.mocked(getClient).mockResolvedValue(fakeClient(postMock) as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "dante", "observe"]);

    expect(postMock).toHaveBeenCalledWith("/v1/dante/observe", {});
  });

  it("exits non-zero on a non-ok response (e.g. the 403 'did not traverse the gateway' shape)", async () => {
    const postMock = vi.fn().mockRejectedValue(new Error("403"));
    vi.mocked(getClient).mockResolvedValue(fakeClient(postMock) as never);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "dante", "observe"]);

    expect(exitSpy.mock.calls[0]?.[0]).not.toBe(0);
  });
});
