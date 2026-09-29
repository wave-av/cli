import chalk from "chalk";
import { WaveError, RateLimitError } from "@wave-av/sdk";
import { EXIT_CODES } from "./exit-codes.js";
import { detectEnvironment } from "./environment.js";
import {
  getAuthSuggestions,
  getRateLimitSuggestions,
  toStructuredError,
} from "./suggestions.js";

/**
 * A command whose SDK call is real and correctly typed, but whose gateway route has no live backend
 * behind it TODAY — verified, not assumed (a specific such gap: `wave creator revenue`/`payouts`/
 * `analytics`, see src/commands/creator/index.ts). Distinct from `WaveError`: this never reaches the
 * network, so there is no status code, request ID, or upstream body — the whole point is to fail
 * BEFORE inviting a payment (or any other response) for a capability that does not exist yet.
 */
export class CapabilityUnavailableError extends Error {
  public readonly capability: string;

  constructor(message: string, capability: string) {
    super(message);
    this.name = "CapabilityUnavailableError";
    this.capability = capability;
  }
}

/**
 * No credential at all: neither WAVE_API_KEY nor a key stored by `wave auth login`. Raised BEFORE
 * any request, so it carries no status code or request ID.
 */
export class AuthRequiredError extends Error {
  constructor(message = "Not authenticated. Run `wave auth login` (or set WAVE_API_KEY) first.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

/**
 * Gateway codes meaning "no WAVE capability is served at this path": ROUTE_NOT_FOUND (no spoke)
 * and ROUTE_NOT_MAPPED (fail-closed: no scope rule). Neither means "your resource does not exist",
 * so they must not read as an ordinary 404 that invites the user to retry with another ID.
 */
const UNSERVED_ROUTE_CODES = new Set(["ROUTE_NOT_FOUND", "ROUTE_NOT_MAPPED"]);

/** True when the command line asked for JSON (-o json, --output json, --output=json). */
export function argvRequestsJson(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "-o" || arg === "--output") && argv[i + 1] === "json") return true;
    if (arg === "--output=json" || arg === "-ojson") return true;
  }
  return false;
}

export function formatCLIError(error: unknown): { message: string; exitCode: number } {
  const detected = detectEnvironment();
  const env = { ...detected, preferJson: detected.preferJson || argvRequestsJson(process.argv) };

  if (error instanceof AuthRequiredError) {
    const exitCode = EXIT_CODES.AUTH_REQUIRED;
    if (env.preferJson) {
      const structured = toStructuredError("AUTH_REQUIRED", error.message, exitCode, [
        { message: "Authenticate", command: "wave auth login" },
        { message: "Use an API key", command: "export WAVE_API_KEY=..." },
      ]);
      return { message: JSON.stringify(structured, null, 2), exitCode };
    }
    return { message: chalk.red(error.message), exitCode };
  }

  if (error instanceof WaveError && UNSERVED_ROUTE_CODES.has(error.code)) {
    const exitCode = EXIT_CODES.NOT_IMPLEMENTED;
    const message =
      `This command's API route is not served by the WAVE API yet (${error.code}). ` +
      "Nothing was created or charged.";
    if (env.preferJson) {
      const structured = toStructuredError(error.code, message, exitCode, [], error.requestId);
      return { message: JSON.stringify(structured, null, 2), exitCode };
    }
    const lines = [
      chalk.yellow(message),
      error.requestId ? chalk.dim(`  Request ID: ${error.requestId}`) : "",
    ].filter(Boolean);
    return { message: lines.join("\n"), exitCode };
  }

  if (error instanceof CapabilityUnavailableError) {
    const exitCode = EXIT_CODES.NOT_IMPLEMENTED;
    if (env.preferJson) {
      const structured = toStructuredError("CAPABILITY_UNAVAILABLE", error.message, exitCode, []);
      return { message: JSON.stringify(structured, null, 2), exitCode };
    }
    return { message: chalk.yellow(error.message), exitCode };
  }

  if (error instanceof RateLimitError) {
    if (env.preferJson) {
      const structured = toStructuredError(
        "RATE_LIMITED",
        `Rate limit exceeded. Retry after ${error.retryAfter}ms.`,
        EXIT_CODES.RATE_LIMITED,
        [
          { message: "Check your usage", command: "wave billing usage" },
          { message: "Check your plan", command: "wave billing status" },
        ],
        error.requestId,
      );
      return { message: JSON.stringify(structured, null, 2), exitCode: EXIT_CODES.RATE_LIMITED };
    }
    return {
      message: getRateLimitSuggestions(),
      exitCode: EXIT_CODES.RATE_LIMITED,
    };
  }

  if (error instanceof WaveError) {
    const exitCode =
      error.statusCode === 401 ? EXIT_CODES.AUTH_REQUIRED :
      error.statusCode === 403 ? EXIT_CODES.PERMISSION_DENIED :
      error.statusCode === 404 ? EXIT_CODES.NOT_FOUND :
      error.statusCode === 422 ? EXIT_CODES.VALIDATION_ERROR :
      error.statusCode === 429 ? EXIT_CODES.RATE_LIMITED :
      EXIT_CODES.GENERAL_ERROR;

    if (env.preferJson) {
      const suggestions =
        error.statusCode === 401
          ? [{ message: "Authenticate", command: "wave auth login" }, { message: "Use API key", command: "export WAVE_API_KEY=..." }]
          : error.statusCode === 404
            ? [{ message: "List resources", command: "wave <resource> list" }]
            : [];
      const structured = toStructuredError(
        error.code,
        error.message,
        exitCode,
        suggestions,
        error.requestId,
      );
      return { message: JSON.stringify(structured, null, 2), exitCode };
    }

    if (error.statusCode === 401) {
      return { message: getAuthSuggestions(), exitCode };
    }

    const lines = [
      chalk.red(error.message),
      chalk.dim(`  Code: ${error.code} | Status: ${error.statusCode}`),
      error.requestId ? chalk.dim(`  Request ID: ${error.requestId}`) : "",
      error.retryable ? chalk.yellow("  This error is retryable.") : "",
    ].filter(Boolean);

    return { message: lines.join("\n"), exitCode };
  }

  if (error instanceof Error) {
    if (env.preferJson) {
      const structured = toStructuredError(
        "CLI_ERROR",
        error.message,
        EXIT_CODES.GENERAL_ERROR,
        [],
      );
      return { message: JSON.stringify(structured, null, 2), exitCode: EXIT_CODES.GENERAL_ERROR };
    }
    return {
      message: chalk.red(`Error: ${error.message}`),
      exitCode: EXIT_CODES.GENERAL_ERROR,
    };
  }

  return {
    message: chalk.red(`Unexpected error: ${String(error)}`),
    exitCode: EXIT_CODES.GENERAL_ERROR,
  };
}

export function wrapCommand<T extends unknown[]>(
  fn: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (error) {
      const { message, exitCode } = formatCLIError(error);
      console.error(message);
      process.exit(exitCode);
    }
  };
}
