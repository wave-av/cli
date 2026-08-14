/**
 * Standardized exit codes for both humans and AI agents.
 * AI agents can parse these to determine the failure category
 * without needing to parse error messages.
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  AUTH_REQUIRED: 2,
  AUTH_EXPIRED: 3,
  NOT_FOUND: 4,
  VALIDATION_ERROR: 5,
  RATE_LIMITED: 6,
  PERMISSION_DENIED: 7,
  NETWORK_ERROR: 8,
  CONFIG_ERROR: 9,
  TIMEOUT: 10,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
