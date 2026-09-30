import { afterEach, describe, expect, it, vi } from "vitest";
import { WaveError } from "@wave-av/sdk";
import {
  AuthRequiredError,
  CapabilityUnavailableError,
  ConfigError,
  KEYCHAIN_TIMEOUT_EXIT_STATUS,
  KeychainTimeoutError,
  exitCodeFor,
  formatCLIError,
  wrapCommand,
} from "./errors.js";
import { EXIT_CODES } from "./exit-codes.js";
import { sanitizeForTerminal } from "./terminal.js";

// Human (interactive terminal) mode: the branch that prints API text straight to a terminal.
// Non-interactive runs, like this test runner, would otherwise get the JSON envelope.
vi.mock("./environment.js", () => ({
  detectEnvironment: () => ({
    isCI: false,
    isAgent: false,
    isInteractive: true,
    preferJson: false,
    supportsColor: false,
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wrapCommand: a keychain that never answers", () => {
  it("flushes the message to stderr, THEN ends the process with SIGKILL (process.exit would hang)", async () => {
    const order: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string, done?: () => void) => {
      order.push(`stderr:${String(chunk).trim().slice(0, 40)}`);
      done?.();
      return true;
    }) as typeof process.stderr.write);
    const kill = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: string) => {
      order.push(`kill:${pid}:${signal}`);
      return true;
    }) as typeof process.kill);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await wrapCommand(async () => {
      throw new KeychainTimeoutError("The OS keychain did not answer within 60s (store).");
    })();

    expect(order).toEqual([
      expect.stringMatching(/^stderr:.*keychain did not answer/),
      `kill:${process.pid}:SIGKILL`,
    ]);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it("reports the real status the shell will see (137 = 128 + SIGKILL)", () => {
    expect(exitCodeFor(new KeychainTimeoutError("x"))).toBe(KEYCHAIN_TIMEOUT_EXIT_STATUS);
    expect(KEYCHAIN_TIMEOUT_EXIT_STATUS).toBe(137);
  });
});

describe("exit codes", () => {
  it("maps each failure class to its documented code", () => {
    expect(exitCodeFor(new ConfigError("bad config"))).toBe(EXIT_CODES.CONFIG_ERROR);
    expect(exitCodeFor(new WaveError("gone", "ROUTE_NOT_FOUND", 404))).toBe(EXIT_CODES.NOT_IMPLEMENTED);
    expect(exitCodeFor(new WaveError("gone", "ROUTE_NOT_MAPPED", 404))).toBe(EXIT_CODES.NOT_IMPLEMENTED);
    expect(exitCodeFor(new WaveError("no such clip", "NOT_FOUND", 404))).toBe(EXIT_CODES.NOT_FOUND);
    expect(exitCodeFor(new WaveError("bad key", "UNAUTHORIZED", 401))).toBe(EXIT_CODES.AUTH_REQUIRED);
    expect(exitCodeFor(new WaveError("scope", "SCOPE_INSUFFICIENT", 403))).toBe(EXIT_CODES.PERMISSION_DENIED);
  });
});

describe("terminal output of API-controlled text", () => {
  it("strips ESC/BEL/C1 and bidi overrides, keeps tab and newline", () => {
    expect(sanitizeForTerminal("a\u001b[31mred\u001b[0m\u0007b\u009bc\u202Ed\u2066e\u2069\te\nf")).toBe("a[31mred[0mbcde\te\nf");
    expect(sanitizeForTerminal(undefined)).toBe("");
  });

  it("an error message from a response cannot drive the terminal", () => {
    const { message } = formatCLIError(new WaveError("boom\u001b]8;;https://evil.example\u0007click", "E", 500));
    expect(message).not.toContain("\u001b]8;");
    expect(message).toContain("boom]8;;https://evil.exampleclick");
  });

  it("local-config, auth, keychain, capability and non-Error failures are sanitized too", () => {
    // Review finding (PR #86): these branches printed error.message raw. ConfigError embeds
    // WAVE_BASE_URL / the saved baseUrl verbatim, and a thrown non-Error can be any text.
    const osc = "\u001b]0;pwned\u0007";
    const failures: unknown[] = [
      new ConfigError(`WAVE_BASE_URL must use https: ${osc}`),
      new AuthRequiredError(`no key ${osc}`),
      new KeychainTimeoutError(`keychain ${osc}`),
      new CapabilityUnavailableError(`not yet ${osc}`, "cap"),
      `thrown string ${osc}`,
    ];
    for (const failure of failures) {
      const { message } = formatCLIError(failure);
      expect(message).not.toContain("\u001b]0;");
      expect(message).not.toContain("\u0007");
      expect(message).toContain("]0;pwned");
    }
  });
});
