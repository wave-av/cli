/**
 * Neutralize text that came from the network before it reaches a terminal.
 *
 * API-controlled strings (a profile name, an organization name, an error message) are printed by
 * human-mode output. An ESC byte in one of them starts an ANSI/OSC sequence the terminal executes:
 * it can recolor or erase earlier lines, retitle the window, or plant a clickable link, so a
 * response could spoof what the CLI appears to say. This removes the C0 controls (keeping tab and
 * newline), DEL, the C1 controls, and the Unicode bidi overrides that reorder how text displays.
 * Without its ESC, a sequence is inert printable text. JSON output needs none of this:
 * JSON.stringify already escapes control characters.
 */
// Every range is written as a code-point escape: literal bidi controls in source are themselves a
// Trojan Source hazard (they reorder how the line displays in an editor or review tool).
// LRE..RLO is U+202A..U+202E; LRI..PDI is U+2066..U+2069.
// eslint-disable-next-line no-control-regex
const UNSAFE_FOR_TERMINAL = /[\u{0}-\u{8}\u{B}-\u{1F}\u{7F}-\u{9F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu;

export function sanitizeForTerminal(value: unknown): string {
  return String(value ?? "").replace(UNSAFE_FOR_TERMINAL, "");
}
