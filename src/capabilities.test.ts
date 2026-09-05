import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createProgram } from "./cli.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * CAP-001 — `capabilities.json` must list exactly the top-level subcommands `wave` actually
 * registers. It previously listed 7 (including `feed` and `agent`, which do not exist) while 54
 * were registered, so any consumer of capabilities.json (docs, discovery, another agent deciding
 * what this CLI can do) was reading a fiction. This test fails the moment the two drift again in
 * either direction — a new command that forgets to update capabilities.json, or a capabilities.json
 * entry that names a command nobody registered.
 */
describe("CAP-001: capabilities.json subcommands match what wave.cli actually registers", () => {
  it("lists every registered top-level command and nothing else", () => {
    const capabilities = JSON.parse(
      readFileSync(join(__dirname, "..", "capabilities.json"), "utf-8"),
    ) as {
      exposes: { cli: Array<{ binary: string; subcommands: string[] }> };
    };

    const declared = capabilities.exposes.cli.find((c) => c.binary === "wave")?.subcommands;
    expect(declared, "capabilities.json has no wave binary entry").toBeDefined();

    const program = createProgram();
    const registered = program.commands.map((c) => c.name()).sort();

    expect([...(declared ?? [])].sort()).toEqual(registered);
  });

  it("does not name feed or agent — neither is a registered command", () => {
    const capabilities = JSON.parse(
      readFileSync(join(__dirname, "..", "capabilities.json"), "utf-8"),
    ) as {
      exposes: { cli: Array<{ binary: string; subcommands: string[] }> };
    };
    const declared = capabilities.exposes.cli.find((c) => c.binary === "wave")?.subcommands ?? [];
    expect(declared).not.toContain("feed");
    expect(declared).not.toContain("agent");
  });
});
