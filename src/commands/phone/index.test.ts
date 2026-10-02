import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `wave phone *` marked preview per D1 — `/v1/phone` returns 404 ROUTE_NOT_FOUND, same as
 * `/v1/streams`. Mirrors `../stream/index.test.ts`.
 */
vi.mock("../../lib/api-client.js", () => ({
  getClient: vi.fn(),
}));

import { getClient } from "../../lib/api-client.js";
import { registerPhoneCommands } from "./index.js";

const PREVIEW_MESSAGE =
  "Preview: phone/telephony is not on the public API yet. `/v1/phone` returns 404 ROUTE_NOT_FOUND.";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-o, --output <format>", "", "table");
  registerPhoneCommands(program);
  return program;
}

const CASES: Array<{ name: string; args: string[] }> = [
  { name: "phone call", args: ["phone", "call", "--to", "+15551234567", "--from", "+15557654321"] },
  { name: "phone conference create", args: ["phone", "conference", "create", "--name", "Standup"] },
  { name: "phone conference list", args: ["phone", "conference", "list"] },
  { name: "phone numbers list", args: ["phone", "numbers", "list"] },
  { name: "phone numbers provision", args: ["phone", "numbers", "provision"] },
];

describe("wave phone — preview guard (D1)", () => {
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
});
