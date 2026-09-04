import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The single source of truth for "what version of the WAVE CLI is this?".
 *
 * Every version-bearing surface — `wave --version`, the help banner, the outbound
 * `X-Wave-CLI-Version` header and the `User-Agent` — MUST derive from this module.
 * A hardcoded version literal anywhere else is the defect class, not a typo: the
 * published CLI shipped a literal that stopped tracking package.json and reported a
 * stale version to users and to the gateway long after the real version had moved on.
 * `src/cli.test.ts` scans `src/` and fails the build if a new literal appears.
 *
 * Resolution walks UP from this module's own location to the nearest directory holding
 * a package.json with a string `version`. That is deliberately depth-independent: in
 * development this file is `src/lib/version.ts` (two levels below the package root),
 * while the shipped bundle is a single `dist/index.js` (one level below it). A fixed
 * `../package.json` would be correct in exactly one of those two layouts and silently
 * wrong in the other, which is how depth-coupled version reads break at publish time.
 */

/** Returned when package.json cannot be located or parsed — never a plausible-looking version. */
export const UNKNOWN_VERSION = "0.0.0-unknown";

function readOwnVersion(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    const { root } = parse(dir);

    for (;;) {
      const candidate = join(dir, "package.json");
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as { version?: unknown };
        if (typeof pkg.version === "string" && pkg.version.length > 0) {
          return pkg.version;
        }
      }

      if (dir === root) break;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    return UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
}

/** The running CLI's version, read once from package.json at process start. */
export const CLI_VERSION = readOwnVersion();

/**
 * The canonical outbound User-Agent. Centralised so every HTTP caller reports the same
 * version as `wave --version` — see the Corridor guardrail on constructing outbound
 * request headers through a single utility rather than inline per call site.
 */
export function cliUserAgent(): string {
  return `wave-cli/${CLI_VERSION}`;
}
