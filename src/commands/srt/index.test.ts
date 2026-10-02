import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api-client.js", () => ({
  getClient: vi.fn(),
}));
vi.mock("../../lib/output/confirm.js", () => ({
  confirmDestructive: vi.fn().mockResolvedValue(true),
}));

import { getClient } from "../../lib/api-client.js";
import { registerSrtCommands } from "./index.js";

function fakeClient(overrides: Partial<Record<"get" | "post" | "put" | "patch" | "delete", ReturnType<typeof vi.fn>>> = {}) {
  return {
    client: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      on: vi.fn(),
      ...overrides,
    },
  };
}

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-o, --output <format>", "", "json");
  program.option("-c, --confirm", "");
  registerSrtCommands(program);
  return program;
}

describe("wave srt inputs", () => {
  beforeEach(() => {
    vi.mocked(getClient).mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("create calls POST /v1/srt/inputs with title/latency and prints the SRT URL", async () => {
    const postMock = vi.fn().mockResolvedValue({ id: "in_1", srtUrl: "srt://ingest.wave.online:9999?streamid=in_1" });
    const client = fakeClient({ post: postMock });
    vi.mocked(getClient).mockResolvedValue(client as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "srt", "inputs", "create", "--title", "My Input"]);

    expect(postMock).toHaveBeenCalledWith("/v1/srt/inputs", { title: "My Input", latencyMs: 200 });
    const logged = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("srt://ingest.wave.online:9999?streamid=in_1");
  });

  it("create forwards --passphrase and --latency-ms", async () => {
    const postMock = vi.fn().mockResolvedValue({ id: "in_2", srtUrl: "srt://x" });
    const client = fakeClient({ post: postMock });
    vi.mocked(getClient).mockResolvedValue(client as never);

    const program = buildProgram();
    await program.parseAsync([
      "node", "wave", "srt", "inputs", "create",
      "--title", "Encrypted", "--passphrase", "supersecret1", "--latency-ms", "500",
    ]);

    expect(postMock).toHaveBeenCalledWith("/v1/srt/inputs", {
      title: "Encrypted",
      latencyMs: 500,
      passphrase: "supersecret1",
    });
  });

  it("list calls GET /v1/srt/inputs with a limit param", async () => {
    const getMock = vi.fn().mockResolvedValue({ data: [{ id: "in_1", srtUrl: "srt://x" }] });
    const client = fakeClient({ get: getMock });
    vi.mocked(getClient).mockResolvedValue(client as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "srt", "inputs", "list", "--limit", "5"]);

    expect(getMock).toHaveBeenCalledWith("/v1/srt/inputs", { params: { limit: 5 } });
  });

  it("get calls GET /v1/srt/inputs/:id", async () => {
    const getMock = vi.fn().mockResolvedValue({ id: "in_1", srtUrl: "srt://x" });
    const client = fakeClient({ get: getMock });
    vi.mocked(getClient).mockResolvedValue(client as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "srt", "inputs", "get", "in_1"]);

    expect(getMock).toHaveBeenCalledWith("/v1/srt/inputs/in_1");
  });

  it("delete calls DELETE /v1/srt/inputs/:id after confirmation", async () => {
    const deleteMock = vi.fn().mockResolvedValue(undefined);
    const client = fakeClient({ delete: deleteMock });
    vi.mocked(getClient).mockResolvedValue(client as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "srt", "inputs", "delete", "in_1"]);

    expect(deleteMock).toHaveBeenCalledWith("/v1/srt/inputs/in_1");
  });

  it("exits non-zero when the gateway returns a non-ok response", async () => {
    const postMock = vi.fn().mockRejectedValue(new Error("boom"));
    const client = fakeClient({ post: postMock });
    vi.mocked(getClient).mockResolvedValue(client as never);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "srt", "inputs", "create", "--title", "X"]);

    expect(exitSpy).toHaveBeenCalledWith(expect.any(Number));
    expect(exitSpy.mock.calls[0]?.[0]).not.toBe(0);
  });
});
