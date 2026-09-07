#!/usr/bin/env bash
# scripts/release/lib.sh
#
# Dependency-free shared helpers for the release pipeline. Sourced by
# check-drift.sh and resolve-tag.sh, and safe to `source` directly from a
# GitHub Actions `run:` step. No npm packages — bash + git + npm + gh only,
# all of which are already required by release.yml / release-drift.yml.
#
# Every function here is designed to be called standalone from a laptop
# shell against the LIVE registry/repo, so the drift check this repo ships
# is genuinely testable locally, not just inside CI.

set -uo pipefail

# ---------------------------------------------------------------------------
# npm_scope_of <package-name>
# Prints the "@scope" portion of a package name, or nothing if unscoped.
# ---------------------------------------------------------------------------
npm_scope_of() {
  local name="$1"
  case "$name" in
    @*/*) echo "${name%%/*}" ;;
    *) : ;;
  esac
}

# ---------------------------------------------------------------------------
# npm_public_view <spec> [npm-view-args...]
# <spec> is "pkg" or "pkg@version" (scoped or not).
#
# ALWAYS queries the PUBLIC npm registry (https://registry.npmjs.org by
# default, override with NPM_PUBLIC_REGISTRY), even when the caller's
# ~/.npmrc has a scope-specific registry override pointing elsewhere.
#
# Measured 2026-09-05: this machine's ~/.npmrc routes the @wave-av scope to
# https://npm.pkg.github.com (GitHub Packages), so a bare
# `npm view @wave-av/cli version` 404s against the WRONG registry and reads
# as "package does not exist" instead of the real public-npm truth. The
# explicit `--<scope>:registry=<public>` flag below overrides that scope
# mapping for this one invocation without touching any .npmrc file.
# ---------------------------------------------------------------------------
npm_public_view() {
  local spec="$1"; shift
  local pkg
  case "$spec" in
    @*/*@*) pkg="${spec%@*}" ;;   # scoped, with @version
    @*/*)   pkg="$spec" ;;         # scoped, no version
    *@*)    pkg="${spec%@*}" ;;    # unscoped, with @version
    *)      pkg="$spec" ;;         # unscoped, no version
  esac
  local scope
  scope="$(npm_scope_of "$pkg")"
  local registry="${NPM_PUBLIC_REGISTRY:-https://registry.npmjs.org}"
  if [ -n "$scope" ]; then
    npm view "$spec" --registry="$registry" "--${scope}:registry=${registry}" "$@"
  else
    npm view "$spec" --registry="$registry" "$@"
  fi
}

# ---------------------------------------------------------------------------
# pkg_json_version <path-to-package.json>
# Prints the version field. Fails loud (non-zero, nothing on stdout) if the
# file is missing or unparseable — callers must treat that as UNREADABLE,
# never as "no drift".
# ---------------------------------------------------------------------------
pkg_json_version() {
  local path="$1"
  [ -f "$path" ] || return 1
  node -e "
    const fs = require('fs');
    try {
      const pkg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      if (!pkg.version) { process.exit(1); }
      process.stdout.write(String(pkg.version));
    } catch { process.exit(1); }
  " "$path"
}

# ---------------------------------------------------------------------------
# latest_v_tag
# Prints the highest semver `v*` tag reachable in this checkout (requires
# `git fetch --tags` to have run / a full clone). Empty + non-zero if there
# are no v* tags at all.
# ---------------------------------------------------------------------------
latest_v_tag() {
  git tag -l 'v*' --sort=-v:refname | head -n1
}

# ---------------------------------------------------------------------------
# gh_release_exists <repo> <tag>
# Exit 0  -> a GitHub Release exists for <tag>
# Exit 1  -> confirmed NO release exists for <tag> (gh said "release not found")
# Exit 2  -> could not determine (gh missing, unauthenticated, network error)
# ---------------------------------------------------------------------------
gh_release_exists() {
  local repo="$1" tag="$2"
  command -v gh >/dev/null 2>&1 || return 2
  local out
  if out="$(gh release view "$tag" --repo "$repo" 2>&1)"; then
    return 0
  fi
  if printf '%s' "$out" | grep -qi 'release not found'; then
    return 1
  fi
  # Any other failure (auth, network, rate limit) is unreadable, not "no release".
  echo "gh_release_exists: could not determine release state for $repo@$tag: $out" >&2
  return 2
}

# ---------------------------------------------------------------------------
# npm_has_provenance <package>@<version>
# Exit 0 -> dist.attestations is present (provenance attestation published)
# Exit 1 -> confirmed absent
# Exit 2 -> could not read the registry at all
# ---------------------------------------------------------------------------
npm_has_provenance() {
  local spec="$1"
  local json
  if ! json="$(npm_public_view "$spec" --json 2>/tmp/.npm_prov_err.$$)"; then
    local err
    err="$(cat /tmp/.npm_prov_err.$$ 2>/dev/null || true)"
    rm -f /tmp/.npm_prov_err.$$
    if printf '%s' "$err" | grep -qi 'E404'; then
      # A real, confirmed 404 means the version does not exist — that is a
      # version-drift finding elsewhere, not "provenance unreadable" here.
      # Treat as "no provenance" since there is nothing published to attest.
      return 1
    fi
    echo "npm_has_provenance: registry unreadable for $spec: $err" >&2
    return 2
  fi
  rm -f /tmp/.npm_prov_err.$$
  node -e "
    let d = '';
    process.stdin.on('data', c => d += c);
    process.stdin.on('end', () => {
      try {
        const j = JSON.parse(d);
        process.exit(j && j.dist && j.dist.attestations ? 0 : 1);
      } catch { process.exit(2); }
    });
  " <<< "$json"
}
