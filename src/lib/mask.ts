/**
 * Secret masking for anything the CLI prints.
 *
 * `wave doctor` output is routinely pasted verbatim into bug reports, issues and chat
 * threads, so it must never echo raw key material. A *prefix* is the worst thing to
 * show: for most providers the leading characters carry the key's type/environment
 * (e.g. `wv_live_...` vs `wv_test_...`) and prefix disclosure narrows an offline search.
 * A short suffix is enough for a human to tell two keys apart and reveals no structure.
 */

/** Characters of the original value revealed, at most, at the END of a masked secret. */
const REVEALED = 4;

/**
 * Minimum input length before any character is revealed. Below this, revealing 4 of N
 * characters would expose too large a fraction of the secret, so mask it completely.
 */
const MIN_LENGTH_TO_REVEAL = 12;

/**
 * Mask a secret for display.
 *
 * Returns a fixed-width mask plus at most the last {@link REVEALED} characters, and never
 * leaks the value's length. Short or empty values are masked entirely.
 *
 * @example
 * maskSecret("wv_live_abcdefghijklmnop") // "****mnop"
 * maskSecret("short")                    // "****"
 */
export function maskSecret(value: string | null | undefined): string {
  if (!value || value.length < MIN_LENGTH_TO_REVEAL) return "****";
  return `****${value.slice(-REVEALED)}`;
}
