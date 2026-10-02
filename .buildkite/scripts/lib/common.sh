#!/usr/bin/env bash
# Shared helpers for .buildkite/scripts/*.sh. SOURCED by every step script, never run directly.
#
#   - `set -euo pipefail`, and never `set -x` (xtrace would print expanded values into the build log).
#   - Never print an environment variable's VALUE. Errors name the variable, never its contents.
#   - Branch names, commit messages and PR titles are untrusted data: never eval'd, never interpolated
#     into a command string. Any BUILDKITE_* value used as an argument is validated first.
#   - Temp dirs are job-local and removed on exit.
#   - The one credential any step uses (NODE_AUTH_TOKEN, governance-enforce only) is moved into a
#     NON-exported shell variable here, before anything else runs.
set -euo pipefail

BK_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export BK_REPO_ROOT

BK_SAME_REPO_RE='^(https://|git://|ssh://git@|git@)github\.com[:/]wave-av/cli(\.git)?$'

_bk_cleanup_paths=()

# shellcheck disable=SC2034 # read by lib/npm-install.sh
_BK_NPM_TOKEN="${NODE_AUTH_TOKEN:-}"
unset NODE_AUTH_TOKEN

bk_cleanup_on_exit() {
  local p
  for p in "${_bk_cleanup_paths[@]+"${_bk_cleanup_paths[@]}"}"; do
    rm -rf -- "$p"
  done
}
trap bk_cleanup_on_exit EXIT

bk_section() {
  printf -- '--- %s\n' "$*"
}

bk_err() {
  printf 'error: %s\n' "$*" >&2
}

# bk_mktemp_dir <var>: create a job-local temp dir, register it for cleanup, store its path in <var>.
bk_mktemp_dir() {
  local __dir
  __dir="$(mktemp -d "${TMPDIR:-/tmp}/bk.XXXXXX")"
  _bk_cleanup_paths+=("$__dir")
  printf -v "$1" '%s' "$__dir"
}

bk_require_tools() {
  local tool missing=0
  for tool in "$@"; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      bk_err "required tool '$tool' is not on PATH (build-image prerequisite, see .buildkite/README.md)"
      missing=1
    fi
  done
  return "$missing"
}

# bk_assert_node_major <major>: the GH job this step mirrors pins that Node major.
bk_assert_node_major() {
  bk_require_tools node
  local want="$1" major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$major" != "$want" ]]; then
    bk_err "Node ${want}.x is required (the mirrored GH job pins node-version ${want}); found major ${major}"
    return 1
  fi
  printf 'node %s, npm %s\n' "$(node --version)" "$(npm --version 2>/dev/null || printf 'absent')"
}

# A credential is only ever used for builds of this repository, never for a PR from a fork.
bk_assert_same_repo_pr() {
  if [[ "${BUILDKITE_PULL_REQUEST:-false}" != "false" ]]; then
    if [[ ! "${BUILDKITE_PULL_REQUEST_REPO:-}" =~ $BK_SAME_REPO_RE ]]; then
      bk_err "BUILDKITE_PULL_REQUEST_REPO is not this repository; refusing to use a credential for a PR from another repository"
      return 1
    fi
  fi
}

# bk_npm_ci_public: deterministic install from package-lock.json, no credential (every dependency of
# this package is on the public npm registry). --include=dev as in the GH jobs.
bk_npm_ci_public() {
  bk_section "npm ci --include=dev (package-lock.json)"
  if [[ ! -f "${BK_REPO_ROOT}/package-lock.json" ]]; then
    bk_err "package-lock.json is missing; refusing a non-deterministic install"
    return 1
  fi
  (cd "$BK_REPO_ROOT" && npm ci --include=dev --no-audit --no-fund)
}
