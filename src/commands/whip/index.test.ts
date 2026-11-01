import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api-client.js", () => ({
  getClient: vi.fn(),
}));

import { getClient } from "../../lib/api-client.js";
import { registerWhipCommands } from "./index.js";

function fakeClient(postMock: ReturnType<typeof vi.fn>) {
  return { client: { get: vi.fn(), post: postMock, put: vi.fn(), patch: vi.fn(), delete: vi.fn(), on: vi.fn() } };
}

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-o, --output <format>", "", "json");
  registerWhipCommands(program);
  return program;
}

describe("wave whip publish", () => {
  beforeEach(() => {
    vi.mocked(getClient).mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--url calls POST /v1/whip/publish and prints the WHIP URL + token for OBS", async () => {
    const postMock = vi.fn().mockResolvedValue({
      whipUrl: "https://whip.wave.online/publish/sess_1",
      token: "wv_whip_tok_1",
      location: "/v1/whip/publish/sess_1",
    });
    vi.mocked(getClient).mockResolvedValue(fakeClient(postMock) as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "whip", "publish", "--url", "rtsp://camera.local/stream"]);

    expect(postMock).toHaveBeenCalledWith("/v1/whip/publish", { url: "rtsp://camera.local/stream" });
    const logged = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("https://whip.wave.online/publish/sess_1");
    expect(logged).toContain("wv_whip_tok_1");
    expect(logged).toMatch(/OBS/);
  });

  it("--file calls POST /v1/whip/publish with the file field", async () => {
    const postMock = vi.fn().mockResolvedValue({ whipUrl: "https://whip.wave.online/x", token: "t" });
    vi.mocked(getClient).mockResolvedValue(fakeClient(postMock) as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "whip", "publish", "--file", "/tmp/clip.mp4"]);

    expect(postMock).toHaveBeenCalledWith("/v1/whip/publish", { file: "/tmp/clip.mp4" });
  });

  it("errors, without calling getClient, when neither --file nor --url is given", async () => {
    const program = buildProgram();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await program.parseAsync(["node", "wave", "whip", "publish"]);

    expect(getClient).not.toHaveBeenCalled();
    expect(exitSpy.mock.calls[0]?.[0]).not.toBe(0);
  });

  it("errors when both --file and --url are given", async () => {
    const program = buildProgram();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await program.parseAsync(["node", "wave", "whip", "publish", "--file", "a", "--url", "b"]);

    expect(getClient).not.toHaveBeenCalled();
    expect(exitSpy.mock.calls[0]?.[0]).not.toBe(0);
  });

  it("exits non-zero on a non-ok response", async () => {
    const postMock = vi.fn().mockRejectedValue(new Error("gateway 502"));
    vi.mocked(getClient).mockResolvedValue(fakeClient(postMock) as never);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "whip", "publish", "--url", "https://x"]);

    expect(exitSpy.mock.calls[0]?.[0]).not.toBe(0);
  });
});
