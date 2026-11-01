import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api-client.js", () => ({
  getClient: vi.fn(),
}));

import { getClient } from "../../lib/api-client.js";
import { registerMoqCommands } from "./index.js";

function fakeClient(postMock: ReturnType<typeof vi.fn>) {
  return { client: { get: vi.fn(), post: postMock, put: vi.fn(), patch: vi.fn(), delete: vi.fn(), on: vi.fn() } };
}

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-o, --output <format>", "", "json");
  registerMoqCommands(program);
  return program;
}

describe("wave moq token", () => {
  beforeEach(() => {
    vi.mocked(getClient).mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("publish mints a token via POST /v1/moq/publish/:ns/:track", async () => {
    const postMock = vi.fn().mockResolvedValue({ token: "tok_pub", ns: "room-1", track: "video" });
    vi.mocked(getClient).mockResolvedValue(fakeClient(postMock) as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "moq", "token", "publish", "--ns", "room-1", "--track", "video"]);

    expect(postMock).toHaveBeenCalledWith("/v1/moq/publish/room-1/video");
  });

  it("subscribe mints a token via POST /v1/moq/subscribe/:ns/:track", async () => {
    const postMock = vi.fn().mockResolvedValue({ token: "tok_sub", ns: "room-1", track: "video" });
    vi.mocked(getClient).mockResolvedValue(fakeClient(postMock) as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "moq", "token", "subscribe", "--ns", "room-1", "--track", "video"]);

    expect(postMock).toHaveBeenCalledWith("/v1/moq/subscribe/room-1/video");
  });

  it("URL-encodes ns/track path segments", async () => {
    const postMock = vi.fn().mockResolvedValue({ token: "tok", ns: "a b", track: "c/d" });
    vi.mocked(getClient).mockResolvedValue(fakeClient(postMock) as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "moq", "token", "publish", "--ns", "a b", "--track", "c/d"]);

    expect(postMock).toHaveBeenCalledWith("/v1/moq/publish/a%20b/c%2Fd");
  });

  it("exits non-zero on a non-ok response", async () => {
    const postMock = vi.fn().mockRejectedValue(new Error("gateway 500"));
    vi.mocked(getClient).mockResolvedValue(fakeClient(postMock) as never);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "moq", "token", "publish", "--ns", "r", "--track", "v"]);

    expect(exitSpy.mock.calls[0]?.[0]).not.toBe(0);
  });
});
