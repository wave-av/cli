import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposeProposal } from "./types.js";

vi.mock("../../lib/api-client.js", () => ({
  getClient: vi.fn(),
}));

import { getClient } from "../../lib/api-client.js";
import { registerComposeCommands } from "./index.js";
import { renderComposeMarkdown } from "./render.js";

const FIXTURE: ComposeProposal = {
  id: "prp_webinar_fixture",
  intent: "live captions for tomorrow's webinar",
  stages: [{ product: "captions", why: "puts that text on the stream for viewers" }],
  productIds: ["captions"],
  tools: ["wave_create_caption_job"],
  scopes: [{ scope: "captions:write", mintable: false, source: "open-by-default.ts:140" }],
  priceRows: [
    {
      product: "captions",
      meter: "wave_caption_minutes",
      usd: 0.025,
      unit: "caption minute",
      quotedAt: 1757100000,
      validForS: 60,
    },
  ],
  callShape: { http: "curl -X POST https://gateway.wave.online/v1/captions ...", mcp: null },
  next: ["Add chapters after the webinar ends"],
  executes: false,
  grounding: "live",
  groundedAt: "2026-09-06T04:12:09Z",
  manifestHash: "sha256:59b188cc",
  engine: { route: "dispatch", promptHash: "sha256:abc", model: null },
  flowId: null,
};

function buildProgram(): { program: Command; postMock: ReturnType<typeof vi.fn> } {
  const program = new Command();
  program.exitOverride();
  program.option("-o, --output <format>", "", "table");
  registerComposeCommands(program);

  const postMock = vi.fn().mockResolvedValue(FIXTURE);
  const fakeClient = {
    client: {
      post: postMock,
      get: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      on: vi.fn(),
    },
  };
  vi.mocked(getClient).mockResolvedValue(fakeClient as never);

  return { program, postMock };
}

describe("wave compose", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(getClient).mockReset();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls POST /v1/compose exactly once and no other client method, ever", async () => {
    const { program, postMock } = buildProgram();
    await program.parseAsync(["node", "wave", "compose", "live captions for tomorrow's webinar"]);

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith("/v1/compose", { intent: "live captions for tomorrow's webinar" });
  });

  it("makes no other network call: get/put/patch/delete are never invoked", async () => {
    const { program } = buildProgram();
    await program.parseAsync(["node", "wave", "compose", "an intent"]);

    const fakeClient = await vi.mocked(getClient).mock.results[0]!.value;
    expect(fakeClient.client.get).not.toHaveBeenCalled();
    expect(fakeClient.client.put).not.toHaveBeenCalled();
    expect(fakeClient.client.patch).not.toHaveBeenCalled();
    expect(fakeClient.client.delete).not.toHaveBeenCalled();
  });

  it("prints markdown by default, equal to the pure renderer's output for the same proposal (rendering parity)", async () => {
    const { program } = buildProgram();
    await program.parseAsync(["node", "wave", "compose", "live captions for tomorrow's webinar"]);

    const printed = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(printed).toBe(renderComposeMarkdown(FIXTURE));
  });

  it("--json prints the raw object, round-tripping to the same proposal", async () => {
    const { program } = buildProgram();
    await program.parseAsync([
      "node",
      "wave",
      "compose",
      "live captions for tomorrow's webinar",
      "--json",
    ]);

    const printed = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(JSON.parse(printed)).toEqual(FIXTURE);
  });

  it("--flow <id> sends flowId in the request body", async () => {
    const { program, postMock } = buildProgram();
    await program.parseAsync(["node", "wave", "compose", "an intent", "--flow", "flw_abc123"]);

    expect(postMock).toHaveBeenCalledWith("/v1/compose", { intent: "an intent", flowId: "flw_abc123" });
  });

  it("--budget <usd> sends budgetUsd as a number in the request body", async () => {
    const { program, postMock } = buildProgram();
    await program.parseAsync(["node", "wave", "compose", "an intent", "--budget", "5"]);

    expect(postMock).toHaveBeenCalledWith("/v1/compose", { intent: "an intent", budgetUsd: 5 });
  });

  it("rejects a non-numeric --budget before making any network call", async () => {
    const { program, postMock } = buildProgram();
    await program.parseAsync(["node", "wave", "compose", "an intent", "--budget", "not-a-number"]);

    expect(postMock).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalled();
  });

  it("rejects a negative --budget before making any network call", async () => {
    const { program, postMock } = buildProgram();
    await program.parseAsync(["node", "wave", "compose", "an intent", "--budget", "-1"]);

    expect(postMock).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalled();
  });

  it("--save prints a save request without ever calling a second network endpoint", async () => {
    const { program, postMock } = buildProgram();
    await program.parseAsync([
      "node",
      "wave",
      "compose",
      "live captions for tomorrow's webinar",
      "--save",
    ]);

    expect(postMock).toHaveBeenCalledTimes(1);
    const printed = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(printed).toContain("/api/console/flows");
    expect(printed).toContain('"kind":"wave-composer"');
    expect(printed).toContain("signed-in console session");
  });
});
