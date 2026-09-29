import { Command, Help } from "commander";
import chalk from "chalk";
import { EXIT_CODES } from "./exit-codes.js";
import { detectEnvironment } from "./environment.js";
import { toStructuredError } from "./suggestions.js";

/**
 * Command groups the WAVE gateway does not serve today (dec-unserved-families (b), WAVE Core
 * go-live, decided 2026-09). Verified live against api.wave.online/v1/* on 2026-09-28: every
 * route under these prefixes returns 404 ROUTE_NOT_FOUND with the SAME body —
 *
 *   {"error":{"code":"ROUTE_NOT_FOUND","message":"No WAVE capability is served at this
 *   path.","doc_url":"https://gateway.wave.online/.well-known/wave-skills.json", ...}}
 *
 * — the gateway's own free capability index. `productions`/`cameras` (the OpenAPI-level "camera/
 * production" family named in the go-live definition) have no corresponding top-level CLI command
 * group at all (there is no `wave camera` or `wave production`; see `capabilities.json`), so there
 * is nothing to hide for that family here — it is a gateway/OpenAPI-only gap.
 *
 * HEALING: once the gateway ships a real route for one of these groups (tracked separately there),
 * remove ITS name from this list in a deliberate, reviewed edit — never all six at once "to be
 * safe". Each group stays fully registered (so `wave <group> --help` and `wave --all` still show
 * the real, SDK-backed subcommands) — only the default top-level `--help` listing and the runtime
 * behavior change.
 */
export const UNSERVED_GROUPS = ["stream", "studio", "editor", "phone", "collab", "podcast"] as const;
export type UnservedGroup = (typeof UNSERVED_GROUPS)[number];

/** The gateway's own free capability index — verified live, see module doc comment above. */
export const GATEWAY_DOC_URL = "https://gateway.wave.online/.well-known/wave-skills.json";

const NOT_YET_SERVED_TAG = "(not yet served)";

export function unservedMessage(group: string): string {
  return (
    `wave ${group}: not yet served by the WAVE API today. Every /v1/${group}* route returns ` +
    `404 ROUTE_NOT_FOUND. ${GATEWAY_DOC_URL} is the gateway's free capability index — it lists ` +
    `every route that IS served right now. Run \`wave --all\` to see this group listed (tagged ` +
    `"${NOT_YET_SERVED_TAG}"), or watch https://changelog.wave.online for when it ships.`
  );
}

/**
 * Fails BEFORE any network call, with the gateway's real doc_url, and exits 1 — never lets an
 * unserved-family subcommand make the request and surface a raw 404 to the caller.
 */
export function exitUnserved(group: string): never {
  const env = detectEnvironment();
  if (env.preferJson) {
    const structured = toStructuredError(
      "ROUTE_NOT_FOUND",
      unservedMessage(group),
      EXIT_CODES.GENERAL_ERROR,
      [{ message: "List every route the gateway currently serves", docs: GATEWAY_DOC_URL }],
    );
    console.error(JSON.stringify(structured, null, 2));
  } else {
    console.error(chalk.yellow(unservedMessage(group)));
  }
  process.exit(EXIT_CODES.GENERAL_ERROR);
}

/** `wave --all` (checked directly against argv: this runs before commander has parsed options). */
function wantsAll(argv: readonly string[]): boolean {
  return argv.includes("--all");
}

class UnservedAwareHelp extends Help {
  constructor(private readonly showAll: boolean) {
    super();
  }

  override visibleCommands(cmd: Command): Command[] {
    // `program.createHelp` (the only place this subclass is installed, see
    // `applyUnservedGroups` below) is only ever invoked to render the ROOT program's OWN
    // top-level listing — `wave <group> --help` renders via the group's own (unoverridden)
    // `createHelp()`, so it still shows real subcommands, same as the existing `wave creator`
    // precedent (src/commands/creator/index.ts).
    const commands = super.visibleCommands(cmd);
    if (this.showAll) return commands;
    return commands.filter((c) => !(UNSERVED_GROUPS as readonly string[]).includes(c.name()));
  }
}

/**
 * Wires the unserved-family guard onto an already-fully-registered program:
 *  - every action inside an unserved group fails via `exitUnserved` before touching the network
 *  - the root `--help` listing omits these groups unless `--all` was passed
 *  - under `--all`, each group's description gets the "(not yet served)" tag
 */
export function applyUnservedGroups(program: Command): void {
  const showAll = wantsAll(process.argv);

  for (const name of UNSERVED_GROUPS) {
    const group = program.commands.find((cmd) => cmd.name() === name);
    if (!group) continue; // defensive: command group renamed/removed elsewhere

    group.hook("preAction", () => exitUnserved(name));

    if (showAll) {
      const description = group.description();
      if (!description.includes(NOT_YET_SERVED_TAG)) {
        group.description(`${description} ${NOT_YET_SERVED_TAG}`.trim());
      }
    }
  }

  program.createHelp = () => new UnservedAwareHelp(showAll);
}
