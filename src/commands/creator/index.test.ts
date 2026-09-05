import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCreatorCommands } from "./index.js";

/**
 * Regression tests for the creator-monetization honesty fix.
 *
 * `wave creator revenue` / `wave creator payouts` used to call `client.creator.getRevenue()` /
 * `.listPayouts()` / `.requestPayout()` / `.getAnalytics()` against `/v1/creators/*`, a gateway
 * surface with no live route (no product-spoke entry, no gateway-native handler, and the legacy
 * WSC fallback that used to catch stray /v1/* paths was decommissioned). Because "creator" is
 * still a resolvable pricing scope, a call that reached the gateway risked a payable 402 for a
 * route that serves nothing. These commands must now fail loudly, with a specific message, and —
 * the part that matters most — WITHOUT EVER MAKING A NETWORK REQUEST.
 */

vi.mock("../../lib/api-client.js", () => ({
  getClient: vi.fn(),
}));

import { getClient } from "../../lib/api-client.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-o, --output <format>", "", "table");
  registerCreatorCommands(program);
  return program;
}

const CASES: Array<{ name: string; args: string[] }> = [
  { name: "creator revenue", args: ["creator", "revenue", "--creator-id", "c_1"] },
  { name: "creator payouts list", args: ["creator", "payouts", "list", "--creator-id", "c_1"] },
  {
    name: "creator payouts request",
    args: [
      "creator",
      "payouts",
      "request",
      "--creator-id",
      "c_1",
      "--amount-cents",
      "100",
      "--method",
      "stripe",
    ],
  },
  { name: "creator analytics", args: ["creator", "analytics", "--creator-id", "c_1"] },
];

describe("wave creator — backend-unavailable guard", () => {
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
    it(`\`wave ${name}\` fails loudly without ever calling getClient / the network`, async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "wave", ...args]);

      // The whole point: never reach the SDK/gateway for a route that has nothing behind it.
      expect(getClient).not.toHaveBeenCalled();

      expect(exitSpy).toHaveBeenCalledWith(11); // EXIT_CODES.NOT_IMPLEMENTED
      const printed = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(printed).toMatch(/not available/i);
      expect(printed).not.toMatch(/at\s+.*\(.*:\d+:\d+\)/); // no stack trace leaked to the user
    });
  }
});
