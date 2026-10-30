#!/usr/bin/env bash
# Registry auth for the governance enforcer install. SOURCED after lib/common.sh.
#
# @wave-av/governance resolves from the fleet Verdaccio mirror
# (https://registry.wave-ci.internal:8443/, pinhole-reachable from FPC guests only), reached with the
# read-only WAVE_REGISTRY_READ_TOKEN the agent environment hook exports for the governance-enforce
# step. Same pattern as wave-dispatch. GitHub Packages is NOT used: NODE_AUTH_TOKEN is retired
# fleet-wide and GPR reads 403 on the org billing limit (WAVE-30233).
#
# The governance-enforce step only runs on main pushes (see pipeline.yml), so PR builds never hold
# this credential. lib/common.sh has already moved it into the non-exported _BK_REG_TOKEN;
# bk_npm_with_token hands it to exactly one npm command. The token never touches disk: the job-local
# npmrc holds the literal placeholder ${WAVE_REGISTRY_READ_TOKEN}, which npm expands at request time.
set -euo pipefail
: "${BK_REPO_ROOT:?lib/npm-install.sh must be sourced after lib/common.sh}"

_BK_REGISTRY_URL="https://registry.wave-ci.internal:8443"
_BK_REGISTRY_CA="/usr/local/share/ca-certificates/wave-registry-ca.crt"
_BK_NPMRC=""

bk_npm_auth() {
  bk_assert_same_repo_pr
  if [[ "${BUILDKITE_PULL_REQUEST:-false}" != "false" ]]; then
    bk_err "refusing to use a registry credential on a PR build (PR builds get no secrets)"
    return 1
  fi
  if [[ -z "${_BK_REG_TOKEN:-}" ]]; then
    bk_err "WAVE_REGISTRY_READ_TOKEN is not set. The enforcer install needs the fleet Verdaccio read credential for @wave-av/*; it must come from the agent environment hook, never from pipeline YAML."
    return 1
  fi
  local npm_dir
  bk_mktemp_dir npm_dir
  # shellcheck disable=SC2016 # the literal ${WAVE_REGISTRY_READ_TOKEN} is intended: npm expands it, the shell must not
  printf '%s\n' \
    "@wave-av:registry=${_BK_REGISTRY_URL}/" \
    "//registry.wave-ci.internal:8443/:_authToken=\${WAVE_REGISTRY_READ_TOKEN}" \
    > "${npm_dir}/npmrc"
  chmod 600 "${npm_dir}/npmrc"
  _BK_NPMRC="${npm_dir}/npmrc"
}

bk_npm_with_token() {
  if [[ -z "$_BK_NPMRC" ]]; then
    bk_err "bk_npm_with_token called before bk_npm_auth"
    return 1
  fi
  WAVE_REGISTRY_READ_TOKEN="$_BK_REG_TOKEN" NPM_CONFIG_USERCONFIG="$_BK_NPMRC" NODE_EXTRA_CA_CERTS="$_BK_REGISTRY_CA" "$@"
}

bk_npm_drop_token() {
  _BK_REG_TOKEN=""
  _BK_NPMRC=""
}
