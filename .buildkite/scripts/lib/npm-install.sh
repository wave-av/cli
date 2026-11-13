#!/usr/bin/env bash
# Private-registry auth for the governance enforcer install. SOURCED after lib/common.sh.
#
# @wave-av/governance is private. It resolves from WAVE's self-hosted Verdaccio registry, read with the
# read-only WAVE_REGISTRY_READ_TOKEN (GitHub Packages is retired; NODE_AUTH_TOKEN is no longer read).
# This repository is public, so it never names the registry host: the host job-secrets path delivers the
# registry's base URL as WAVE_REGISTRY_URL alongside the token. lib/common.sh has already moved both into
# non-exported shell variables; bk_npm_with_token hands them to exactly one npm command. The token never
# touches disk: the job-local npmrc holds the literal placeholder ${WAVE_REGISTRY_READ_TOKEN}, and the
# npmrc is deleted as soon as the install returns.
#
# Today the host gives a public repository no job-secrets row (ci-smoke host/buildkite/secrets-allowlist.tsv),
# so on Buildkite this step stops at the first check below, loudly, before any credential could be used.
set -euo pipefail
: "${BK_REPO_ROOT:?lib/npm-install.sh must be sourced after lib/common.sh}"

_BK_NPMRC=""
# The registry's private CA, installed by the golden image. Added to node's trust for the one install
# command only.
_BK_REGISTRY_CA="/usr/local/share/ca-certificates/wave-registry-ca.crt"
# An https origin with an optional port and a trailing slash: no credentials, path, query or whitespace.
_BK_REGISTRY_URL_RE='^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?/$'

bk_npm_auth() {
  bk_assert_same_repo_pr
  if [[ -z "${_BK_NPM_TOKEN:-}" ]]; then
    bk_err "WAVE_REGISTRY_READ_TOKEN is not set. The enforcer install needs the private registry's read credential from the host job-secrets path, never from pipeline YAML (this public repository has no job-secrets row today)."
    return 1
  fi
  if [[ ! "${_BK_REGISTRY_URL:-}" =~ $_BK_REGISTRY_URL_RE ]]; then
    bk_err "WAVE_REGISTRY_URL is not set or is not an https origin ending in '/'. It must come from the host job-secrets path with WAVE_REGISTRY_READ_TOKEN."
    return 1
  fi
  local npm_dir
  bk_mktemp_dir npm_dir
  # shellcheck disable=SC2016 # the literal ${WAVE_REGISTRY_READ_TOKEN} is intended: npm expands it, the shell must not
  printf '%s\n' \
    "@wave-av:registry=${_BK_REGISTRY_URL}" \
    "//${_BK_REGISTRY_URL#https://}:_authToken="'${WAVE_REGISTRY_READ_TOKEN}' \
    > "${npm_dir}/npmrc"
  chmod 600 "${npm_dir}/npmrc"
  _BK_NPMRC="${npm_dir}/npmrc"
}

# bk_npm_with_token <command...>: run ONE command with the credential, the job-local npmrc, a null global
# npmrc and the registry CA in its environment. None of them is exported to the calling shell.
bk_npm_with_token() {
  if [[ -z "$_BK_NPMRC" ]]; then
    bk_err "bk_npm_with_token called before bk_npm_auth"
    return 1
  fi
  WAVE_REGISTRY_READ_TOKEN="$_BK_NPM_TOKEN" NPM_CONFIG_USERCONFIG="$_BK_NPMRC" NPM_CONFIG_GLOBALCONFIG=/dev/null \
    NODE_EXTRA_CA_CERTS="$_BK_REGISTRY_CA" "$@"
}

# Drop the credential from this shell once the install is done, and delete the job-local npmrc now
# rather than at exit, so the enforcer and the git fetches after it cannot be pointed at it.
bk_npm_drop_token() {
  _BK_NPM_TOKEN=""
  if [[ -n "$_BK_NPMRC" ]]; then
    rm -f -- "$_BK_NPMRC"
  fi
  _BK_NPMRC=""
}
