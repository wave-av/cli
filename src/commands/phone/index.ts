import { Command } from "commander";
import { previewExit } from "../../lib/preview.js";

/**
 * `wave phone *` used to call `client.phone.*`, which targets `/v1/phone`. Verified via the GA
 * readiness audit: `POST /v1/phone` is in the same hard-break list as `/v1/streams` — 404
 * ROUTE_NOT_FOUND, "no spoke and no override" (wave-gateway `src/forward-target.ts:89`) —
 * telephony is not a served route on the public API. Marked preview per D1 (this lane's go-live
 * fix plan): every subcommand now prints an honest preview notice and exits 2 WITHOUT
 * constructing an SDK client or making any network call — mirrors `wave stream`, see that file's
 * header for the full rationale.
 */
const PREVIEW_MESSAGE =
  "Preview: phone/telephony is not on the public API yet. `/v1/phone` returns 404 ROUTE_NOT_FOUND.";

const PREVIEW_SUBCOMMANDS = [
  { name: "call", description: "[PREVIEW] Initiate a call — not served on the public API yet" },
] as const;

const PREVIEW_CONFERENCE_SUBCOMMANDS = [
  { name: "create", description: "[PREVIEW] Create a conference — not served on the public API yet" },
  { name: "list", description: "[PREVIEW] List conferences — not served on the public API yet" },
] as const;

const PREVIEW_NUMBERS_SUBCOMMANDS = [
  { name: "list", description: "[PREVIEW] List numbers — not served on the public API yet" },
  { name: "provision", description: "[PREVIEW] Provision a number — not served on the public API yet" },
] as const;

export function registerPhoneCommands(program: Command): void {
  const phone = program
    .command("phone")
    .description("[PREVIEW] Telephony — not on the public API yet")
    .allowUnknownOption();

  for (const { name, description } of PREVIEW_SUBCOMMANDS) {
    phone
      .command(`${name} [args...]`)
      .description(description)
      .allowUnknownOption()
      .action(() => {
        previewExit(PREVIEW_MESSAGE);
      });
  }

  const conference = phone
    .command("conference")
    .description("[PREVIEW] Conference calls — not on the public API yet");
  for (const { name, description } of PREVIEW_CONFERENCE_SUBCOMMANDS) {
    conference
      .command(`${name} [args...]`)
      .description(description)
      .allowUnknownOption()
      .action(() => {
        previewExit(PREVIEW_MESSAGE);
      });
  }

  const numbers = phone.command("numbers").description("[PREVIEW] Phone numbers — not on the public API yet");
  for (const { name, description } of PREVIEW_NUMBERS_SUBCOMMANDS) {
    numbers
      .command(`${name} [args...]`)
      .description(description)
      .allowUnknownOption()
      .action(() => {
        previewExit(PREVIEW_MESSAGE);
      });
  }
}
