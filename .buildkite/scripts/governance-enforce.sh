#!/usr/bin/env bash
# Step `governance-enforce`: governance-enforce.yml `enforce`. Runs the @wave-av/governance enforcer
# (secrets + hardcoded paths) over the diff, on PR builds and on pushes to main.
#
# Same pins and fail-closed rules as the GH job: @wave-av/governance@0.4.6 exactly, --ignore-scripts,
# and a base that cannot be resolved means a FULL scan against the empty tree, never a partial or
# empty one. Buildkite has no PR base sha or push `before` sha, so:
#   - PR build: merge-base of HEAD with a freshly fetched origin/<base branch>. The branch name is
#     untrusted input, checked with `git check-ref-format` and a strict class, passed as one argv.
#   - push to main: the first parent, HEAD^1. For a merge commit that covers the whole merged branch.
#     A direct multi-commit push would only have its last commit scanned (see the README).
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
# shellcheck source-path=SCRIPTDIR source=lib/npm-install.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/npm-install.sh"

GOVERNANCE_VERSION="0.4.6"

cd "$BK_REPO_ROOT"
bk_assert_node_major 22
bk_require_tools git

bk_section "install @wave-av/governance@${GOVERNANCE_VERSION} (isolated)"
bk_npm_auth
gov_dir=""
bk_mktemp_dir gov_dir
(cd "$gov_dir" && bk_npm_with_token npm install "@wave-av/governance@${GOVERNANCE_VERSION}" --no-save --no-audit --no-fund --ignore-scripts)
bk_npm_drop_token
enforcer="${gov_dir}/node_modules/@wave-av/governance/bin/enforce.mjs"
[[ -f "$enforcer" ]] || { bk_err "enforcer not found after install: bin/enforce.mjs"; exit 1; }

bk_section "resolve diff base"
if [[ "$(git rev-parse --is-shallow-repository)" == "true" ]]; then
  git fetch --no-tags --quiet --unshallow origin
fi
base=""
if [[ "${BUILDKITE_PULL_REQUEST:-false}" != "false" ]]; then
  base_branch="${BUILDKITE_PULL_REQUEST_BASE_BRANCH:-}"
  if [[ -n "$base_branch" && "$base_branch" =~ ^[A-Za-z0-9._/-]+$ ]] \
    && git check-ref-format --branch "$base_branch" >/dev/null 2>&1; then
    if git fetch --no-tags --quiet origin -- "+refs/heads/${base_branch}:refs/remotes/origin/${base_branch}"; then
      base="$(git merge-base HEAD "refs/remotes/origin/${base_branch}" || true)"
    fi
  else
    bk_err "BUILDKITE_PULL_REQUEST_BASE_BRANCH is empty or not a valid branch name"
  fi
else
  base="$(git rev-parse --verify --quiet 'HEAD^1' || true)"
fi
if [[ -z "$base" ]] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  base="$(git hash-object -t tree /dev/null)"
  printf '+++ WARNING: indeterminate diff base; scanning the full tree against the empty tree\n'
fi
printf 'diffing against %s\n' "$base"

bk_section "enforce (secrets + hardcoded paths on the diff)"
exec node "$enforcer" --changed "$base"
