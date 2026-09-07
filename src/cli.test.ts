import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "./cli.js";
import { CLI_VERSION, UNKNOWN_VERSION, cliUserAgent } from "./lib/version.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = __dirname;
const PKG_VERSION = (
  JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as {
    version: string;
  }
).version;

/** Strip SGR colour codes so assertions run against the text a user actually reads. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (s: string): string => s.replace(ANSI, "");

/**
 * VER-001 — every version-bearing surface must agree with package.json.
 *
 * Background: published @wave-av/cli@1.0.8 printed `1.0.0` from `wave --version` because the
 * version was a hardcoded literal that stopped tracking package.json. `--version` was fixed to
 * derive from package.json, but two literals survived on the wire (`X-Wave-CLI-Version` and the
 * `User-Agent`), so the gateway still saw 1.0.0. These tests fail if ANY of the four surfaces —
 * package.json, `--version`, the help banner, the outbound headers — drift apart again, and the
 * scan below fails if a new hardcoded literal is introduced anywhere under src/.
 */
describe("VER-001: CLI version is a single source of truth", () => {
  it("derives CLI_VERSION from package.json", () => {
    expect(CLI_VERSION).toBe(PKG_VERSION);
    expect(CLI_VERSION).not.toBe(UNKNOWN_VERSION);
  });

  it("reports the version from package.json via --version, not a hardcoded string", () => {
    const program = createProgram();
    expect(program.version()).toBe(PKG_VERSION);
    // The bug shipped as literally "1.0.0" regardless of the real published version.
    if (PKG_VERSION !== "1.0.0") {
      expect(program.version()).not.toBe("1.0.0");
    }
  });

  it("sends the same version on the wire as it prints", () => {
    expect(cliUserAgent()).toBe(`wave-cli/${PKG_VERSION}`);
  });
});

/**
 * The banner is a SECOND, independent rendering of the version — published 1.0.8 disagreed with
 * itself here. `printBanner` is module-private, and the banner hook is only installed for humans,
 * so the reachable path is: clear the CI/agent env vars, then call `program.helpInformation()`.
 */
describe("VER-001: help banner agrees with package.json", () => {
  const SUPPRESSING_ENV = [
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
  ] as const;

  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const key of SUPPRESSING_ENV) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
  });

  it("prints v<package.json version> in the banner", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    const program = createProgram();
    program.helpInformation();

    const banner = stripAnsi(lines.join("\n"));
    const match = /\bv(\d+\.\d+\.\d+\S*)/.exec(banner);

    expect(match, `no version found in banner:\n${banner}`).not.toBeNull();
    expect(match?.[1]).toBe(PKG_VERSION);
  });
});

/**
 * The defect CLASS gate. Updating a literal to the current version reproduces the bug at the next
 * release; the only durable fix is that no version literal exists in src/ at all. Anything matched
 * here must either derive from `lib/version.ts` or earn an explicit, reasoned allowlist entry that
 * a reviewer has to see in the diff.
 */
const LITERAL_ALLOWLIST: ReadonlyArray<{ file: string; literal: string; reason: string }> = [
  {
    file: "lib/config/schema.ts",
    literal: "1.0.0",
    reason:
      "on-disk CONFIG FILE schema version. Deliberately independent of the CLI version — it " +
      "changes only when the config file format changes, and must NOT track releases.",
  },
  {
    file: "lib/version.ts",
    literal: "0.0.0",
    reason:
      "the UNKNOWN_VERSION sentinel returned when package.json cannot be read. Intentionally " +
      "not a plausible version so a broken install is obvious rather than silently wrong.",
  },
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Whole-line comments only: a doc comment may legitimately narrate the 1.0.0 incident. */
function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

describe("VER-001: no hardcoded version literals under src/", () => {
  it("finds every x.y.z literal derived from lib/version.ts or explicitly allowlisted", () => {
    const offenders: string[] = [];

    for (const file of listTsFiles(SRC_DIR)) {
      const rel = relative(SRC_DIR, file).split(sep).join("/");
      const lines = readFileSync(file, "utf-8").split("\n");

      lines.forEach((line, i) => {
        if (isCommentLine(line)) return;
        for (const m of line.matchAll(/\b\d+\.\d+\.\d+/g)) {
          const allowed = LITERAL_ALLOWLIST.some(
            (a) => a.file === rel && a.literal === m[0],
          );
          if (!allowed) offenders.push(`${rel}:${i + 1} ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      "Hardcoded version literal(s) found. Import CLI_VERSION / cliUserAgent() from " +
        "src/lib/version.ts instead of writing a version string, or add a reasoned entry to " +
        "LITERAL_ALLOWLIST in this file.",
    ).toEqual([]);
  });
});
