import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { escapeFishSingleQuoted, generateFishCompletion } from "./index.js";

/**
 * Security regression test for CodeQL js/incomplete-sanitization (alert #3).
 *
 * The fish generator escaped `'` but not `\`. fish honours `\\` and `\'` even inside single
 * quotes, so a description ending in a backslash produced `...\'` — the backslash ate the
 * escape, the quote closed the literal early, and the remainder was parsed as fish code by
 * anyone running `wave completion fish | source`.
 */
describe("escapeFishSingleQuoted", () => {
  it("escapes backslashes", () => {
    expect(escapeFishSingleQuoted("a\\b")).toBe("a\\\\b");
  });

  it("escapes single quotes", () => {
    expect(escapeFishSingleQuoted("it's")).toBe("it\\'s");
  });

  it("escapes a trailing backslash so it cannot consume the closing quote", () => {
    // Regression: the old `.replace(/'/g, "\\'")` left this backslash raw.
    const escaped = escapeFishSingleQuoted("danger\\");
    expect(escaped).toBe("danger\\\\");
    // The emitted literal ends with an escaped backslash, then a real closing quote.
    expect(`'${escaped}'`).toBe("'danger\\\\'");
  });

  it("escapes backslashes before quotes, not after", () => {
    // If the quote pass ran first, its injected backslash would be double-escaped.
    expect(escapeFishSingleQuoted("\\'")).toBe("\\\\\\'");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeFishSingleQuoted("Manage CLI configuration")).toBe("Manage CLI configuration");
  });
});

describe("generateFishCompletion", () => {
  function programWithDescription(description: string): Command {
    const program = new Command();
    program.command("evil").description(description);
    return program;
  }

  /**
   * Decode a fish single-quoted literal the way fish itself does: inside `'...'` only `\\`
   * and `\'` are escapes, every other character is literal. Returns the decoded value and
   * the index of the closing quote, so a caller can assert the literal ends where expected.
   */
  function decodeFishSingleQuoted(source: string, start: number): { value: string; end: number } {
    expect(source[start]).toBe("'");
    let value = "";
    let i = start + 1;
    while (i < source.length) {
      const ch = source[i];
      if (ch === "\\") {
        const next = source[i + 1];
        if (next === "\\" || next === "'") {
          value += next;
          i += 2;
          continue;
        }
      }
      if (ch === "'") return { value, end: i };
      value += ch;
      i += 1;
    }
    throw new Error(`unterminated fish single-quoted literal in: ${source}`);
  }

  /** Extract and decode the `-d '...'` description argument of a completion line. */
  function decodeDescription(line: string): { value: string; end: number } {
    const marker = " -d ";
    const at = line.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    return decodeFishSingleQuoted(line, at + marker.length);
  }

  function completionLine(description: string): string {
    const script = generateFishCompletion(programWithDescription(description));
    const line = script.split("\n").find((l) => l.includes("-a 'evil'"));
    expect(line).toBeDefined();
    return line!;
  }

  it("does not let a backslash-terminated description break out of the quoted literal", () => {
    const line = completionLine("pwn\\");

    expect(line).toContain("-d 'pwn\\\\'");
    // The literal must round-trip AND close at the very end of the line. Before the fix it
    // closed early, leaving the remainder of the line as executable fish code.
    const { value, end } = decodeDescription(line);
    expect(value).toBe("pwn\\");
    expect(end).toBe(line.length - 1);
  });

  it("does not let a quote-injected description inject fish code", () => {
    const line = completionLine("x'; echo pwned; '");

    const { value, end } = decodeDescription(line);
    expect(value).toBe("x'; echo pwned; '");
    expect(end).toBe(line.length - 1);
  });

  it("escapes quotes inside a description", () => {
    expect(completionLine("it's fine")).toContain("-d 'it\\'s fine'");
  });

  it("round-trips an ordinary description unchanged", () => {
    const line = completionLine("Manage CLI configuration");
    expect(line).toContain("-d 'Manage CLI configuration'");
    expect(decodeDescription(line).value).toBe("Manage CLI configuration");
  });
});
