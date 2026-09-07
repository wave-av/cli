#!/usr/bin/env bash
# scripts/release/check-drift.sh
#
# Jake's decision (2026-09-05): agents build release-on-tag + provenance PRs,
# and it must ALWAYS be codified workflows so there is never drift between
# "the code", "the tag", "npm", and "the GitHub Release". This script IS that
# codified check — release-drift.yml calls it on a schedule/push, and it is
# equally runnable from a laptop against the live registry (no CI-only state).
#
# Compares four independently-sourced facts about @wave-av/cli and fails loud
# on any disagreement:
#   1. the highest `v*` git tag reachable in this checkout
#   2. package.json's `version` field (on the ref given by --pkg-ref, default HEAD)
#   3. `npm view <pkg> version` against the PUBLIC registry (dist-tag `latest`)
#   4. whether a GitHub Release exists for that tag
#   5. whether the published npm version carries a provenance attestation
#      (checked via `dist.attestations` from `npm view --json` — see
#      scripts/release/lib.sh npm_has_provenance for why this field and not
#      `npm audit signatures`: the latter audits an INSTALLED node_modules
#      tree, not an arbitrary published version, so it can't answer "does
#      version X on the registry carry provenance" without installing X
#      first. `dist.attestations` is what the registry itself returns for a
#      version and needs no install step.)
#
# Exit codes (never conflate "can't tell" with "it's fine"):
#   0 = in sync (tag == package.json == npm latest, release exists, provenance present)
#   1 = drift found (deterministically confirmed — details printed)
#   2 = unreadable (couldn't determine one or more facts — e.g. no network,
#       gh unauthenticated, no v* tags found in a shallow clone). NEVER
#       treated as "in sync".
#
# Env overrides: REPO (default wave-av/cli), PKG_JSON (default ./package.json),
# PKG_REF (default: read PKG_JSON from the working tree as-is; set to a git
# ref like `origin/main` to read package.json from that ref instead),
# NPM_PUBLIC_REGISTRY (default https://registry.npmjs.org).

set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

REPO="${REPO:-wave-av/cli}"
PKG_JSON="${PKG_JSON:-package.json}"
PKG_REF="${PKG_REF:-}"

UNREADABLE=0
DRIFT=0

echo "== release-drift check :: $REPO =="

# --- 1. latest v* tag -------------------------------------------------------
TAG="$(latest_v_tag || true)"
if [ -z "$TAG" ]; then
  echo "UNREADABLE: no v* tags found (shallow clone? run 'git fetch --tags')"
  UNREADABLE=1
else
  TAG_VERSION="${TAG#v}"
  echo "git tag (highest v*):     $TAG (version $TAG_VERSION)"
fi

# --- 2. package.json version ------------------------------------------------
if [ -n "$PKG_REF" ]; then
  PKG_VERSION="$(git show "$PKG_REF:$PKG_JSON" 2>/dev/null | node -e "
    let d=''; process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{ try { const j=JSON.parse(d); if(!j.version) throw 0; process.stdout.write(j.version); } catch { process.exit(1);} });
  " || true)"
else
  PKG_VERSION="$(pkg_json_version "$PKG_JSON" || true)"
fi
if [ -z "${PKG_VERSION:-}" ]; then
  echo "UNREADABLE: could not read version from $PKG_JSON${PKG_REF:+ at $PKG_REF}"
  UNREADABLE=1
else
  echo "package.json version:     $PKG_VERSION${PKG_REF:+ (at $PKG_REF)}"
fi

# --- 3. npm registry (public) latest version --------------------------------
PKG_NAME="$(node -e "process.stdout.write(require('./$PKG_JSON').name)" 2>/dev/null || echo "@wave-av/cli")"
NPM_ERR_FILE="$(mktemp)"
if NPM_VERSION="$(npm_public_view "${PKG_NAME}@latest" version 2>"$NPM_ERR_FILE")"; then
  NPM_VERSION="$(printf '%s' "$NPM_VERSION" | tr -d '[:space:]')"
  echo "npm registry (latest tag): $NPM_VERSION"
else
  NPM_ERR="$(cat "$NPM_ERR_FILE")"
  if printf '%s' "$NPM_ERR" | grep -qi 'E404'; then
    echo "npm registry (latest tag): <none published>"
    NPM_VERSION=""
    DRIFT=1
    echo "DRIFT: $PKG_NAME has never been published to the public npm registry"
  else
    echo "UNREADABLE: npm view failed (not a confirmed 404): $NPM_ERR"
    UNREADABLE=1
  fi
fi
rm -f "$NPM_ERR_FILE"

# --- 4. GitHub Release existence for the latest tag -------------------------
if [ -n "$TAG" ]; then
  set +e
  gh_release_exists "$REPO" "$TAG"
  RC=$?
  set -e
  case "$RC" in
    0) echo "GitHub Release for $TAG: exists" ;;
    1) echo "GitHub Release for $TAG: MISSING"; DRIFT=1; echo "DRIFT: no GitHub Release exists for tag $TAG (VER-001)" ;;
    *) echo "UNREADABLE: could not determine GitHub Release state for $TAG"; UNREADABLE=1 ;;
  esac
fi

# --- 5. provenance attestation on the published npm version -----------------
if [ -n "${NPM_VERSION:-}" ]; then
  set +e
  npm_has_provenance "${PKG_NAME}@${NPM_VERSION}"
  RC=$?
  set -e
  case "$RC" in
    0) echo "npm provenance ($PKG_NAME@$NPM_VERSION): present" ;;
    1) echo "npm provenance ($PKG_NAME@$NPM_VERSION): MISSING"; DRIFT=1; echo "DRIFT: $PKG_NAME@$NPM_VERSION has no provenance attestation (SUPPLY-001)" ;;
    *) echo "UNREADABLE: could not determine provenance state for $PKG_NAME@$NPM_VERSION"; UNREADABLE=1 ;;
  esac
fi

# --- version parity across tag / package.json / npm -------------------------
if [ -n "${TAG_VERSION:-}" ] && [ -n "${PKG_VERSION:-}" ] && [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
  DRIFT=1
  echo "DRIFT: latest tag ($TAG_VERSION) != package.json version ($PKG_VERSION)"
fi
if [ -n "${TAG_VERSION:-}" ] && [ -n "${NPM_VERSION:-}" ] && [ "$TAG_VERSION" != "$NPM_VERSION" ]; then
  DRIFT=1
  echo "DRIFT: latest tag ($TAG_VERSION) != npm registry latest ($NPM_VERSION)"
fi
if [ -n "${PKG_VERSION:-}" ] && [ -n "${NPM_VERSION:-}" ] && [ "$PKG_VERSION" != "$NPM_VERSION" ]; then
  DRIFT=1
  echo "DRIFT: package.json version ($PKG_VERSION) != npm registry latest ($NPM_VERSION)"
fi

echo "=========================================="
if [ "$UNREADABLE" -eq 1 ]; then
  echo "RESULT: UNREADABLE — could not confirm sync (exit 2)"
  exit 2
elif [ "$DRIFT" -eq 1 ]; then
  echo "RESULT: DRIFT DETECTED (exit 1)"
  exit 1
else
  echo "RESULT: IN SYNC (exit 0)"
  exit 0
fi
