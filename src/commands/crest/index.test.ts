import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api-client.js", () => ({
  getClient: vi.fn(),
}));

import { getClient } from "../../lib/api-client.js";
import { registerCrestCommands } from "./index.js";

function fakeClient(overrides: Partial<Record<"get" | "post", ReturnType<typeof vi.fn>>> = {}) {
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
  registerCrestCommands(program);
  return program;
}

describe("wave crest sessions", () => {
  beforeEach(() => {
    vi.mocked(getClient).mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("create calls POST /v1/crest/sessions", async () => {
    const postMock = vi.fn().mockResolvedValue({ id: "cr_1" });
    vi.mocked(getClient).mockResolvedValue(fakeClient({ post: postMock }) as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "crest", "sessions", "create", "--title", "Preview room"]);

    expect(postMock).toHaveBeenCalledWith("/v1/crest/sessions", { title: "Preview room" });
  });

  it("list calls GET /v1/crest/sessions", async () => {
    const getMock = vi.fn().mockResolvedValue({ data: [{ id: "cr_1" }] });
    vi.mocked(getClient).mockResolvedValue(fakeClient({ get: getMock }) as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "crest", "sessions", "list"]);

    expect(getMock).toHaveBeenCalledWith("/v1/crest/sessions", { params: { limit: 20 } });
  });

  it("get calls GET /v1/crest/sessions/:id", async () => {
    const getMock = vi.fn().mockResolvedValue({ id: "cr_1" });
    vi.mocked(getClient).mockResolvedValue(fakeClient({ get: getMock }) as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "crest", "sessions", "get", "cr_1"]);

    expect(getMock).toHaveBeenCalledWith("/v1/crest/sessions/cr_1");
  });

  it("exits non-zero on a non-ok response", async () => {
    const postMock = vi.fn().mockRejectedValue(new Error("500"));
    vi.mocked(getClient).mockResolvedValue(fakeClient({ post: postMock }) as never);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "crest", "sessions", "create", "--title", "X"]);

    expect(exitSpy.mock.calls[0]?.[0]).not.toBe(0);
  });
});
