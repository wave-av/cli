import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `wave listen sessions *` — the Listen media spoke's session routes (`/v1/listen/sessions`),
 * nested under the pre-existing `wave listen` (webhook-forwarding) command. These tests cover
 * only the new `sessions` subgroup; the webhook-forwarding behavior above it is unchanged (still
 * gated on SSE/keychain/config, out of this lane's scope) and is left to its own coverage.
 */
vi.mock("../../lib/api-client.js", () => ({
  getClient: vi.fn(),
}));

import { getClient } from "../../lib/api-client.js";
import { registerListenCommands } from "./index.js";

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
  registerListenCommands(program);
  return program;
}

describe("wave listen sessions", () => {
  beforeEach(() => {
    vi.mocked(getClient).mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers `sessions` nested under the existing `listen` command, without removing it", () => {
    const program = buildProgram();
    const listen = program.commands.find((c) => c.name() === "listen");
    expect(listen, "`wave listen` must still be registered").toBeDefined();
    const sessions = listen?.commands.find((c) => c.name() === "sessions");
    expect(sessions, "`wave listen sessions` must be registered").toBeDefined();
  });

  it("sessions create calls POST /v1/listen/sessions", async () => {
    const postMock = vi.fn().mockResolvedValue({ id: "ls_1" });
    vi.mocked(getClient).mockResolvedValue(fakeClient({ post: postMock }) as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "listen", "sessions", "create", "--title", "Booth A"]);

    expect(postMock).toHaveBeenCalledWith("/v1/listen/sessions", { title: "Booth A" });
  });

  it("sessions list calls GET /v1/listen/sessions", async () => {
    const getMock = vi.fn().mockResolvedValue({ data: [{ id: "ls_1" }] });
    vi.mocked(getClient).mockResolvedValue(fakeClient({ get: getMock }) as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "listen", "sessions", "list"]);

    expect(getMock).toHaveBeenCalledWith("/v1/listen/sessions", { params: { limit: 20 } });
  });

  it("sessions get calls GET /v1/listen/sessions/:id", async () => {
    const getMock = vi.fn().mockResolvedValue({ id: "ls_1" });
    vi.mocked(getClient).mockResolvedValue(fakeClient({ get: getMock }) as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "listen", "sessions", "get", "ls_1"]);

    expect(getMock).toHaveBeenCalledWith("/v1/listen/sessions/ls_1");
  });

  it("exits non-zero on a non-ok response", async () => {
    const postMock = vi.fn().mockRejectedValue(new Error("500"));
    vi.mocked(getClient).mockResolvedValue(fakeClient({ post: postMock }) as never);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const program = buildProgram();
    await program.parseAsync(["node", "wave", "listen", "sessions", "create", "--title", "X"]);

    expect(exitSpy.mock.calls[0]?.[0]).not.toBe(0);
  });
});
