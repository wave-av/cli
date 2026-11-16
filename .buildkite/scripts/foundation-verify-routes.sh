#!/usr/bin/env bash
# foundation-verify-routes: the Buildkite twin of .github/workflows/_checks.yml job
# `verify-routes` (URL naming convention for Worker routes). No-op for repos with no
# wrangler.toml. The banned-name rules are copied from the vendored _checks.yml; the host
# extraction also accepts a leading hostname wildcard (see ROUTE_RE), and the message wording
# differs.
set -euo pipefail
cd "$(dirname "$0")/../.."

# Reads only file paths from `git ls-files` (repo-controlled, trusted) and host strings
# extracted via a CONSTRAINED regex from wrangler.toml (PR-controlled). The regex bounds
# matches between quotes (double AND single, both valid TOML strings) and `cut -d/ -f1`
# then keeps only the hostname-shaped prefix. NOTE: the `[^"]*`/`[^']*` suffix CAN include
# shell metacharacters before the first `/`, so extraction alone does NOT sanitize;
# safety comes from ALWAYS double-quoting `$h`/`$f` (never eval or unquoted expansion),
# which the loop below does. Hosts are lowercased before matching (DNS is
# case-insensitive; without this `Foo-EDGE.wave.online` would bypass the cases).
fail=0
any=0
# Double-quoted OR single-quoted (TOML literal string) wave.online host match. A route may start
# with a hostname wildcard (`*-edge.wave.online/*`, `*.wave.online/*`), so the host part is either
# a `*` followed by zero or more host characters, or one or more host characters. Deliberate
# widening over the vendored workflow regex, which required an alphanumeric first character and
# so let a wildcard-prefixed route skip every check.
H="(\*[a-zA-Z0-9._-]*|[a-zA-Z0-9._-]+)"
ROUTE_RE="\"${H}\.wave\.online[^\"]*\"|'${H}\.wave\.online[^']*'"
while IFS= read -r f; do
  any=1
  # Extract host portion (everything before the first /) from `pattern = "host/..."` lines.
  # Handles inline-string `pattern = "..."`, `routes = ["a.wave.online/*", ...]`, and the
  # single-quoted TOML literal-string twins of each (case-insensitive; lowercased below).
  while IFS= read -r h; do
    [ -z "$h" ] && continue
    # Classify the host without its leading wildcard, so `*wave-x.wave.online` meets the same
    # prefix rule as `wave-x.wave.online`. Messages still print the route's host as written.
    case "${h#\*}" in
      *-edge.wave.online)
        echo "error($f): URL '$h' uses banned -edge suffix"; fail=1 ;;
      *.production.wave.online)
        echo "error($f): URL '$h' uses banned .production. (production is the default)"; fail=1 ;;
      wave-*.wave.online)
        echo "error($f): URL '$h' uses banned wave- prefix (redundant on wave.online)"; fail=1 ;;
      *-staging.wave.online)
        echo "error($f): URL '$h' uses banned -staging suffix (use <proto>.staging.wave.online sub-subdomain)"; fail=1 ;;
      *.staging.wave.online)
        echo "notice($f): staging URL $h OK" ;;
      *.dev.wave.online)
        echo "notice($f): dev URL $h OK" ;;
      *.wave.online)
        echo "notice($f): prod URL $h OK" ;;
      *)
        echo "warning($f): URL $h unrecognized — verify against the URL naming convention" ;;
    esac
  done < <(grep -oiE "$ROUTE_RE" "$f" 2>/dev/null | tr -d "\"'" | cut -d/ -f1 | tr '[:upper:]' '[:lower:]' | sort -u)
done < <(git ls-files '*wrangler.toml' 'wrangler*.toml')
if [ "$any" = 0 ]; then echo "no wrangler.toml — verify-routes is a no-op"; exit 0; fi
if [ "$fail" = 0 ]; then echo "verify-routes passed"; fi
exit "$fail"
