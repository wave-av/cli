import { Command } from "commander";
import { previewExit } from "../../lib/preview.js";

/**
 * `wave stream *` used to call `client.pipeline.*`, which targets `/v1/streams`. Verified via the
 * GA readiness audit: `POST /v1/streams` returns 404 ROUTE_NOT_FOUND ("no spoke and no override",
 * wave-gateway `src/forward-target.ts:89`) — generic streams are not a served route on the public
 * API. A CLI command that reached the gateway for this route risked a payable 402 quote for a
 * route that serves nothing.
 *
 * Every subcommand below now prints an honest preview notice and exits 2 WITHOUT constructing an
 * SDK client or making any network call — there is no `getClient` import in this file, on
 * purpose, so a future edit cannot silently reintroduce a network call here.
 *
 * The two protocols the audit confirmed ARE served (`/v1/srt/inputs`, `/v1/whip/publish`) are the
 * suggested next step in the preview message; see `wave srt`/`wave whip`.
 */
const PREVIEW_MESSAGE =
  "Preview: generic streams are not on the public API yet. Use `wave srt inputs create` or `wave whip publish`";

/** Every leaf `wave stream <sub>` command this CLI has ever exposed, kept for `--help` parity. */
const PREVIEW_SUBCOMMANDS = [
  { name: "create", description: "[PREVIEW] Create a stream — not served on the public API yet" },
  { name: "list", description: "[PREVIEW] List streams — not served on the public API yet" },
  { name: "get", description: "[PREVIEW] Get a stream — not served on the public API yet" },
  { name: "update", description: "[PREVIEW] Update a stream — not served on the public API yet" },
  { name: "delete", description: "[PREVIEW] Delete a stream — not served on the public API yet" },
  { name: "start", description: "[PREVIEW] Start a stream — not served on the public API yet" },
  { name: "stop", description: "[PREVIEW] Stop a stream — not served on the public API yet" },
  { name: "restart", description: "[PREVIEW] Restart a stream — not served on the public API yet" },
  { name: "status", description: "[PREVIEW] Stream status — not served on the public API yet" },
  { name: "viewers", description: "[PREVIEW] Viewer count — not served on the public API yet" },
  { name: "metrics", description: "[PREVIEW] Stream metrics — not served on the public API yet" },
  { name: "recordings", description: "[PREVIEW] Recordings — not served on the public API yet" },
] as const;

export function registerStreamCommands(program: Command): void {
  const stream = program
    .command("stream")
    .description("[PREVIEW] Generic streams — not on the public API yet, see `wave srt`/`wave whip`")
    .allowUnknownOption();

  for (const { name, description } of PREVIEW_SUBCOMMANDS) {
    stream
      .command(`${name} [args...]`)
      .description(description)
      .allowUnknownOption()
      .action(() => {
        previewExit(PREVIEW_MESSAGE);
      });
  }
}
