import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * dec-unserved-families (b), WAVE Core go-live (2026-09): `stream`, `studio`, `editor`, `phone`,
 * `collab` and `podcast` all hit gateway routes that return 404 ROUTE_NOT_FOUND today. These tests
 * prove the three-part contract this module implements:
 *
 *   1. The default `wave --help` listing omits all six groups.
 *   2. `wave --all` shows all six, each tagged "(not yet served)", and a served group (e.g.
 *      `auth`) is never mis-tagged or hidden.
 *   3. Invoking ANY subcommand inside an unserved group exits 1 with the gateway's real doc_url
 *      BEFORE any network call — never a raw 404 surfaced from a request that was always going to
 *      fail.
 *
 * `wave <group> --help` (the group's OWN help, not root) is intentionally untouched — verified by
 * the "group help unaffected" case below — because that's what lets `wave --all` communicate real,
 * SDK-backed subcommands underneath a "(not yet served)" tag rather than an empty stub.
 */

vi.mock("../lib/api-client.js", () => ({
  getClient: vi.fn(),
}));

import { getClient } from "./api-client.js";
import { createProgram } from "../cli.js";
import { GATEWAY_DOC_URL, UNSERVED_GROUPS, unservedMessage } from "./unserved.js";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (s: string): string => s.replace(ANSI, "");

/** Env vars that flip detectEnvironment() into non-interactive / agent / CI mode. */
const ENV_KEYS = [
  "CI",
  "GITHUB_ACTIONS",
  "VERCEL",
  "BUILDKITE",
  "GITLAB_CI",
  "CIRCLECI",
  "WAVE_AGENT",
  "CLAUDE_CODE",
  "CURSOR_SESSION",
  "AIDER_SESSION",
  "CONTINUE_SESSION",
  "WAVE_OUTPUT_FORMAT",
] as const;

describe("wave --help: unserved command groups are hidden by default", () => {
  let savedArgv: string[];
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedArgv = process.argv;
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.argv = savedArgv;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
  });

  it("omits every UNSERVED_GROUPS name from the default top-level listing", () => {
    process.argv = ["node", "wave"];
    const program = createProgram();
    const help = stripAnsi(program.helpInformation());

    for (const group of UNSERVED_GROUPS) {
      expect(help, `expected "${group}" to be hidden from default --help`).not.toMatch(
        new RegExp(`^\\s*${group}\\b`, "m"),
      );
    }
  });

  it("still lists a served group (auth) in the default listing", () => {
    process.argv = ["node", "wave"];
    const program = createProgram();
    const help = stripAnsi(program.helpInformation());
    expect(help).toMatch(/\bauth\b/);
  });

  it("`wave --all` shows every UNSERVED_GROUPS name tagged \"(not yet served)\"", () => {
    process.argv = ["node", "wave", "--all"];
    const program = createProgram();
    const help = stripAnsi(program.helpInformation());

    for (const group of UNSERVED_GROUPS) {
      const line = new RegExp(`^\\s*${group}\\b.*\\(not yet served\\)`, "m");
      expect(help, `expected "${group}" tagged "(not yet served)" under --all:\n${help}`).toMatch(
        line,
      );
    }
    // A served group must never pick up the tag.
    expect(help).not.toMatch(/\bauth\b.*\(not yet served\)/);
  });

  it("`wave <group> --help` (the group's own help) is unaffected and lists real subcommands", () => {
    process.argv = ["node", "wave", "stream", "--help"];
    const program = createProgram();
    const streamGroup = program.commands.find((c) => c.name() === "stream");
    expect(streamGroup).toBeDefined();
    const groupHelp = stripAnsi(streamGroup!.helpInformation());
    // The group's own listing is untouched — real subcommands still show (list is one of them).
    expect(groupHelp).toMatch(/\blist\b/);
  });
});

/** Real `process.exit()` never returns control to the caller — mock it the same way, or code
 *  after the call (here: commander invoking the real, network-calling action) keeps running,
 *  which would mask the exact bug this guard exists to prevent. */
class ProcessExit extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe("wave <unserved-group> <subcommand>: fails before any network call", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let savedEnv: Record<string, string | undefined>;

  const CASES: Array<{ group: string; args: string[] }> = [
    { group: "stream", args: ["stream", "list"] },
    { group: "studio", args: ["studio", "list"] },
    { group: "editor", args: ["editor", "list"] },
    { group: "phone", args: ["phone", "call", "--to", "+15551234567", "--from", "+15557654321"] },
    { group: "collab", args: ["collab", "room", "list"] },
    { group: "podcast", args: ["podcast", "episodes", "list", "--podcast-id", "p_1"] },
  ];

  beforeEach(() => {
    vi.mocked(getClient).mockReset();
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new ProcessExit(code);
    }) as unknown as typeof process.exit);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
  });

  for (const { group, args } of CASES) {
    it(`\`wave ${args.join(" ")}\` exits 1 with the gateway doc_url, never calling getClient`, async () => {
      const program = createProgram();
      program.exitOverride();

      await expect(program.parseAsync(["node", "wave", ...args])).rejects.toBeInstanceOf(
        ProcessExit,
      );

      expect(getClient, `${group}: getClient must never be called`).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1); // EXIT_CODES.GENERAL_ERROR

      const printed = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(stripAnsi(printed)).toContain(GATEWAY_DOC_URL);
      expect(stripAnsi(printed)).not.toMatch(/ROUTE_NOT_MAPPED|ROUTE_NOT_FOUND.*404|^\s*at\s+\S+:\d+:\d+/m);
    });
  }

  it("emits a structured JSON error (code, exit_code, doc_url suggestion) when JSON is preferred", async () => {
    process.env["WAVE_OUTPUT_FORMAT"] = "json";
    const program = createProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(["node", "wave", "stream", "list"]),
    ).rejects.toBeInstanceOf(ProcessExit);

    expect(getClient).not.toHaveBeenCalled();
    const printed = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    const parsed = JSON.parse(printed) as {
      error: { code: string; exit_code: number; message: string; suggestions: Array<{ docs?: string }> };
    };
    expect(parsed.error.code).toBe("ROUTE_NOT_FOUND");
    expect(parsed.error.exit_code).toBe(1);
    expect(parsed.error.suggestions.some((s) => s.docs === GATEWAY_DOC_URL)).toBe(true);
  });
});

describe("unservedMessage()", () => {
  it("names the group, the doc_url, and the --all escape hatch", () => {
    const msg = unservedMessage("stream");
    expect(msg).toContain("wave stream");
    expect(msg).toContain(GATEWAY_DOC_URL);
    expect(msg).toContain("--all");
  });
});
