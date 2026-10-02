import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api-client.js", () => ({
  getClient: vi.fn(),
}));

import { getClient } from "../../lib/api-client.js";
import { registerWhepCommands } from "./index.js";

function fakeClient(postMock: ReturnType<typeof vi.fn>) {
  return { client: { get: vi.fn(), post: postMock, put: vi.fn(), patch: vi.fn(), delete: vi.fn(), on: vi.fn() } };
}

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-o, --output <format>", "", "json");
  registerWhepCommands(program);
  return program;
}

describe("wave whep subscribe", () => {
  beforeEach(() => {
    vi.mocked(getClient).mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls POST /v1/whep/subscribe with the resource id and prints the WHEP URL", async () => {
    const postMock = vi.fn().mockResolvedValue({ whepUrl: "https://whep.wave.online/sub/in_1", token: "tok" });
    vi.mocked(getClient).mockResolvedValue(fakeClient(postMock) as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "whep", "subscribe", "--id", "in_1"]);

    expect(postMock).toHaveBeenCalledWith("/v1/whep/subscribe", { id: "in_1" });
    const logged = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("https://whep.wave.online/sub/in_1");
  });

  it("exits non-zero on a non-ok response", async () => {
    const postMock = vi.fn().mockRejectedValue(new Error("404"));
    vi.mocked(getClient).mockResolvedValue(fakeClient(postMock) as never);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "whep", "subscribe", "--id", "missing"]);

    expect(exitSpy.mock.calls[0]?.[0]).not.toBe(0);
  });
});
