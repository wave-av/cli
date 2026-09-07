/**
 * Environment detection for AI agents, CI/CD, and interactive terminals.
 * AI agents should set WAVE_AGENT=1 or CI=1 for optimal behavior.
 */

export interface Environment {
  /** Running in CI/CD pipeline */
  isCI: boolean;
  /** Running as an AI agent (Claude, GPT, etc.) */
  isAgent: boolean;
  /** Terminal is interactive (has TTY) */
  isInteractive: boolean;
  /** JSON output preferred (non-interactive or explicitly requested) */
  preferJson: boolean;
  /** Colors supported */
  supportsColor: boolean;
  /** Agent identifier if running as agent */
  agentName?: string;
}

export function detectEnvironment(): Environment {
  const isCI = Boolean(
    process.env["CI"] ||
      process.env["GITHUB_ACTIONS"] ||
      process.env["VERCEL"] ||
      process.env["BUILDKITE"] ||
      process.env["GITLAB_CI"] ||
      process.env["CIRCLECI"],
  );

  const isAgent = Boolean(
    process.env["WAVE_AGENT"] ||
      process.env["CLAUDE_CODE"] ||
      process.env["CURSOR_SESSION"] ||
      process.env["AIDER_SESSION"] ||
      process.env["CONTINUE_SESSION"],
  );

  const isInteractive = Boolean(process.stdin.isTTY) && !isCI && !isAgent;

  const preferJson =
    !isInteractive ||
    process.env["WAVE_OUTPUT_FORMAT"] === "json" ||
    isAgent;

  const supportsColor =
    process.env["WAVE_NO_COLOR"] !== "1" &&
    process.env["NO_COLOR"] === undefined &&
    (process.env["FORCE_COLOR"] !== undefined || Boolean(process.stdout.isTTY));

  const agentName =
    process.env["WAVE_AGENT_NAME"] ||
    (process.env["CLAUDE_CODE"] ? "claude-code" : undefined) ||
    (process.env["CURSOR_SESSION"] ? "cursor" : undefined);

  return { isCI, isAgent, isInteractive, preferJson, supportsColor, agentName };
}

/**
 * Format output based on environment.
 * AI agents and CI get JSON; interactive terminals get tables.
 */
export function getDefaultOutputFormat(): "json" | "table" {
  const env = detectEnvironment();
  return env.preferJson ? "json" : "table";
}
