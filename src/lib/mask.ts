/**
 * Secret masking for anything the CLI prints.
 *
 * `wave doctor` output is routinely pasted verbatim into bug reports, issues and chat
 * threads, so it must never echo raw key material. A *prefix* is the worst thing to show:
 * for most providers the leading characters carry the key's type/environment (e.g.
 * `wv_live_...` vs `wv_test_...`) and prefix disclosure narrows an offline search.
 *
 * This is deliberately PRESENCE-ONLY: the returned string is a constant and contains no
 * character derived from the input. An earlier revision of this helper revealed the last
 * four characters — the common "show a suffix" convention — and CodeQL's
 * js/clear-text-logging kept flagging it, correctly: a suffix is still key material
 * reaching a log sink. `wave doctor` only needs to answer "is a key configured?", so
 * returning a constant removes the disclosure outright and cuts the taint flow at a real
 * barrier instead of papering over it with an alert dismissal.
 */

/** Shown when a secret IS configured. Constant: never derived from the secret. */
export const MASKED_PLACEHOLDER = "****";

/** Shown when no secret is configured. */
export const ABSENT_PLACEHOLDER = "not set";

/**
 * Render a secret for display without disclosing any of it.
 *
 * The value is used only for a presence test; no part of it is ever returned.
 *
 * @example
 * maskSecret("wv_live_abcdefghijklmnop") // "****"
 * maskSecret("")                         // "not set"
 */
export function maskSecret(value: string | null | undefined): string {
  return value ? MASKED_PLACEHOLDER : ABSENT_PLACEHOLDER;
}
