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
// eslint-disable-next-line no-control-regex
const UNSAFE_FOR_TERMINAL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

export function sanitizeForTerminal(value: unknown): string {
  return String(value ?? "").replace(UNSAFE_FOR_TERMINAL, "");
}
