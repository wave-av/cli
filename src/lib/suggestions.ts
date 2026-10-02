import chalk from "chalk";

/**
 * Context-aware suggestions for common error scenarios.
 * Helps both human developers and AI agents recover from errors.
 */

interface Suggestion {
  message: string;
  command?: string;
  docs?: string;
}

const AUTH_SUGGESTIONS: Suggestion[] = [
  { message: "Authenticate with WAVE", command: "wave login" },
  { message: "Use an API key directly", command: "wave login --api-key <your-key>" },
  { message: "Set env var for CI/CD", command: "export WAVE_API_KEY=wave_live_..." },
];

const NOT_FOUND_SUGGESTIONS: Record<string, Suggestion[]> = {
  // `wave stream *` is a preview stub (see src/commands/stream/index.ts) — its own routes never
  // reach the network, so this entry no longer points at `stream list`/`stream create`. It points
  // at the two GA transport routes that actually serve traffic today.
  stream: [
    { message: "Create an SRT input", command: "wave srt inputs create --title 'My Input'" },
    { message: "Mint a WHIP publish session", command: "wave whip publish --url <source-url>" },
  ],
  studio: [
    { message: "List productions", command: "wave studio list" },
    { message: "Create a production", command: "wave studio create --title 'My Production'" },
  ],
};

const RATE_LIMIT_SUGGESTIONS: Suggestion[] = [
  { message: "Check your current limits", command: "wave billing limits" },
  { message: "Upgrade your plan", command: "wave billing upgrade" },
  { message: "Wait and retry (the CLI does this automatically)" },
];

export function formatSuggestion(suggestion: Suggestion): string {
  const parts = [`  ${chalk.dim(">")} ${suggestion.message}`];
  if (suggestion.command) {
    parts.push(`    ${chalk.cyan("$")} ${chalk.bold(suggestion.command)}`);
  }
  if (suggestion.docs) {
    parts.push(`    ${chalk.dim(suggestion.docs)}`);
  }
  return parts.join("\n");
}

export function getAuthSuggestions(): string {
  const header = chalk.yellow("Not authenticated. Try one of:");
  const suggestions = AUTH_SUGGESTIONS.map(formatSuggestion).join("\n\n");
  return `${header}\n\n${suggestions}`;
}

export function getNotFoundSuggestions(resource: string): string {
  const suggestions = NOT_FOUND_SUGGESTIONS[resource] ?? [
    { message: `List available ${resource}s`, command: `wave ${resource} list` },
  ];
  const header = chalk.yellow(`${resource} not found. Try:`);
  return `${header}\n\n${suggestions.map(formatSuggestion).join("\n\n")}`;
}

export function getRateLimitSuggestions(): string {
  const header = chalk.yellow("Rate limited. Options:");
  return `${header}\n\n${RATE_LIMIT_SUGGESTIONS.map(formatSuggestion).join("\n\n")}`;
}

/**
 * Machine-readable error for AI agents (JSON output mode)
 */
export interface StructuredError {
  error: {
    code: string;
    message: string;
    exit_code: number;
    suggestions: Array<{ message: string; command?: string; docs?: string }>;
    request_id?: string;
  };
}

export function toStructuredError(
  code: string,
  message: string,
  exitCode: number,
  suggestions: Suggestion[],
  requestId?: string,
): StructuredError {
  return {
    error: {
      code,
      message,
      exit_code: exitCode,
      suggestions,
      request_id: requestId,
    },
  };
}
