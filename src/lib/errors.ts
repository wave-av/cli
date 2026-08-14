import chalk from "chalk";
import { WaveError, RateLimitError } from "@wave-av/sdk";
import { EXIT_CODES } from "./exit-codes.js";
import { detectEnvironment } from "./environment.js";
import {
  getAuthSuggestions,
  getRateLimitSuggestions,
  toStructuredError,
} from "./suggestions.js";

export function formatCLIError(error: unknown): { message: string; exitCode: number } {
  const env = detectEnvironment();

  if (error instanceof RateLimitError) {
    if (env.preferJson) {
      const structured = toStructuredError(
        "RATE_LIMITED",
        `Rate limit exceeded. Retry after ${error.retryAfter}ms.`,
        EXIT_CODES.RATE_LIMITED,
        [
          { message: "Check your limits", command: "wave billing limits" },
          { message: "Upgrade your plan", command: "wave billing upgrade" },
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
          ? [{ message: "Authenticate", command: "wave login" }, { message: "Use API key", command: "export WAVE_API_KEY=..." }]
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
