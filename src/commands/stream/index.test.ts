import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `wave stream *` used to call `client.pipeline.*`, which targets `/v1/streams` — a route the GA
 * readiness audit confirmed 404s (ROUTE_NOT_FOUND). These tests prove the fix: every subcommand
 * prints the exact preview message, exits 2, and — the part that matters most — never touches
 * `getClient` / the SDK / the network.
 */
vi.mock("../../lib/api-client.js", () => ({
  getClient: vi.fn(),
}));

import { getClient } from "../../lib/api-client.js";
import { registerStreamCommands } from "./index.js";

const PREVIEW_MESSAGE =
  "Preview: generic streams are not on the public API yet. Use `wave srt inputs create` or `wave whip publish`";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-o, --output <format>", "", "table");
  registerStreamCommands(program);
  return program;
}

const CASES: Array<{ name: string; args: string[] }> = [
  { name: "stream create", args: ["stream", "create", "--title", "My Stream"] },
  { name: "stream list", args: ["stream", "list"] },
  { name: "stream get", args: ["stream", "get", "s_1"] },
  { name: "stream update", args: ["stream", "update", "s_1", "--title", "New"] },
  { name: "stream delete", args: ["stream", "delete", "s_1"] },
  { name: "stream start", args: ["stream", "start", "s_1"] },
  { name: "stream stop", args: ["stream", "stop", "s_1"] },
  { name: "stream restart", args: ["stream", "restart", "s_1"] },
  { name: "stream status", args: ["stream", "status", "s_1"] },
  { name: "stream viewers", args: ["stream", "viewers", "s_1"] },
  { name: "stream metrics", args: ["stream", "metrics", "s_1"] },
  { name: "stream recordings", args: ["stream", "recordings", "s_1"] },
];

describe("wave stream — preview guard", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(getClient).mockReset();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const { name, args } of CASES) {
    it(`\`wave ${name}\` prints the preview message and exits 2, never calling getClient`, async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "wave", ...args]);

      expect(getClient).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(2);

      const printed = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(printed).toContain(PREVIEW_MESSAGE);
    });
  }

  it("`wave stream create` (bare, no flags) still exits 2 with the preview message — the exact liveProof invocation", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "wave", "stream", "create"]);

    expect(getClient).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(2);
    const printed = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(printed).toContain(PREVIEW_MESSAGE);
  });
});
