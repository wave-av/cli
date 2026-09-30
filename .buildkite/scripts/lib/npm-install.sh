#!/usr/bin/env bash
# GitHub Packages auth for the governance enforcer install. SOURCED after lib/common.sh.
#
# @wave-av/governance resolves from GitHub Packages, which needs a read credential. On GHA that is
# GITHUB_TOKEN with packages:read, scoped to the install step. On Buildkite the agent environment hook
# exports NODE_AUTH_TOKEN for the governance-enforce step only. lib/common.sh has already moved it into
# the non-exported _BK_NPM_TOKEN; bk_npm_with_token hands it to exactly one npm command. The token never
# touches disk: the job-local npmrc holds the literal placeholder ${NODE_AUTH_TOKEN}.
set -euo pipefail
: "${BK_REPO_ROOT:?lib/npm-install.sh must be sourced after lib/common.sh}"

_BK_NPMRC=""

bk_npm_auth() {
  bk_assert_same_repo_pr
  if [[ -z "${_BK_NPM_TOKEN:-}" ]]; then
    bk_err "NODE_AUTH_TOKEN is not set. The enforcer install needs a GitHub Packages read credential from the agent environment hook, never from pipeline YAML."
    return 1
  fi
  local npm_dir
  bk_mktemp_dir npm_dir
  # shellcheck disable=SC2016 # the literal ${NODE_AUTH_TOKEN} is intended: npm expands it, the shell must not
  printf '%s\n' \
    '@wave-av:registry=https://npm.pkg.github.com' \
    '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}' \
    > "${npm_dir}/npmrc"
  chmod 600 "${npm_dir}/npmrc"
  _BK_NPMRC="${npm_dir}/npmrc"
}

bk_npm_with_token() {
  if [[ -z "$_BK_NPMRC" ]]; then
    bk_err "bk_npm_with_token called before bk_npm_auth"
    return 1
  fi
  NODE_AUTH_TOKEN="$_BK_NPM_TOKEN" NPM_CONFIG_USERCONFIG="$_BK_NPMRC" "$@"
}

bk_npm_drop_token() {
  _BK_NPM_TOKEN=""
  _BK_NPMRC=""
}
