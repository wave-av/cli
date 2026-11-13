#!/usr/bin/env bash
# Tests for governance-enforce's install of @wave-av/governance: it reads the private registry with
# WAVE_REGISTRY_READ_TOKEN and the host-delivered WAVE_REGISTRY_URL, never GitHub Packages (retired) or
# NODE_AUTH_TOKEN, and the token reaches exactly one command. This repository is public, so nothing under
# .buildkite/ may name the private registry's host.
#
# Run from anywhere: bash .buildkite/tests/registry-install.test.sh. Needs bash, git and node. No network
# and no real credential: npm is a stub that records names and facts (never the token value) and lays down
# a fake enforcer on `npm install`; node answers "22" to the step's major-version check and is the real
# node otherwise. The step runs in a throwaway git repository holding a copy of .buildkite/.
#
#   1. Text: no step script names npm.pkg.github.com on a code line or reads NODE_AUTH_TOKEN; nothing
#      under .buildkite/ names an internal host.
#   2. A main build: npm installs exactly the pinned @wave-av/governance with --ignore-scripts, outside the
#      checkout; its job-local npmrc maps @wave-av to WAVE_REGISTRY_URL with the ${...} placeholder and is
#      mode 600; a null global npmrc and the registry CA; the token is in npm's environment only; the
#      enforcer runs with no token, URL or npmrc env after the npmrc is deleted; nothing is printed.
#   3. Refusals, each before npm runs: no token; no URL; a URL that is not a bare https origin ending in
#      '/'; a PR from another repository.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CA="/usr/local/share/ca-certificates/wave-registry-ca.crt"
URL="https://registry.example.invalid:8443/"
pass=0
fail=0
ok() { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf 'FAIL %s\n' "$1"; }

REAL_NODE="$(command -v node)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
FAKE_TOKEN="registry-test-token-$$-not-real"

# --- 1. text -------------------------------------------------------------------------------------------
code_hits() { grep -rnE "$1" "$ROOT/.buildkite/scripts" | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' || true; }
if [[ -z "$(code_hits 'npm\.pkg\.github\.com')" ]]; then ok "no step script or lib names npm.pkg.github.com"; else bad "no step script or lib names npm.pkg.github.com"; fi
if [[ -z "$(code_hits '\$\{?NODE_AUTH_TOKEN')" ]]; then ok "no step script or lib reads NODE_AUTH_TOKEN"; else bad "no step script or lib reads NODE_AUTH_TOKEN"; fi
# Any *.internal host name (the private registry's included), matched without this file containing one.
if ! grep -rqE '[a-z0-9-]\.internal([:/]|$)' "$ROOT/.buildkite"; then ok "nothing under .buildkite/ names an internal host"; else bad "nothing under .buildkite/ names an internal host"; fi

# --- throwaway repo and stubs ----------------------------------------------------------------------------
repo="$work/repo"
mkdir -p "$repo"
cp -R "$ROOT/.buildkite" "$repo/.buildkite"
git -C "$repo" init -q
git -C "$repo" -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m one
printf 'hello\n' > "$repo/file.txt"
git -C "$repo" add -A
git -C "$repo" -c user.name=t -c user.email=t@example.invalid commit -q -m two

stubs="$work/bin"
mkdir -p "$stubs" "$work/tmp"
cat > "$stubs/node" <<'STUB'
#!/usr/bin/env bash
if [[ "${1:-}" == "-p" && "${2:-}" == *process.versions.node* ]]; then echo 22; exit 0; fi
if [[ "${1:-}" == "--version" ]]; then echo v22.0.0-stub; exit 0; fi
exec "$REAL_NODE" "$@"
STUB
cat > "$stubs/npm" <<'STUB'
#!/usr/bin/env bash
# Records names and facts only, never the token value.
if [[ "${1:-}" == "--version" ]]; then echo "10.0.0-stub"; exit 0; fi
{
  printf -- '--- argv:%s\n' "$*"
  printf 'cwd_in_repo:%s\n' "$([[ "$PWD" == "$STEP_REPO"* ]] && echo yes || echo no)"
  printf 'token_env:%s\n' "$([[ -n "${WAVE_REGISTRY_READ_TOKEN:-}" ]] && echo set || echo unset)"
  printf 'token_matches:%s\n' "$([[ "${WAVE_REGISTRY_READ_TOKEN:-}" == "$EXPECT_TOKEN" ]] && echo yes || echo no)"
  printf 'legacy_env:%s\n' "$([[ -n "${NODE_AUTH_TOKEN+x}" ]] && echo set || echo unset)"
  printf 'url_env:%s\n' "$([[ -n "${WAVE_REGISTRY_URL+x}" ]] && echo set || echo unset)"
  printf 'globalconfig:%s\n' "${NPM_CONFIG_GLOBALCONFIG:-<unset>}"
  printf 'extra_ca:%s\n' "${NODE_EXTRA_CA_CERTS:-<unset>}"
  printf 'userconfig_mode:%s\n' "$(stat -c %a "${NPM_CONFIG_USERCONFIG:-/nonexistent}" 2>/dev/null || echo none)"
  printf 'userconfig_path:%s\n' "${NPM_CONFIG_USERCONFIG:-}"
  if [[ -f "${NPM_CONFIG_USERCONFIG:-}" ]]; then sed 's/^/npmrc:/' "$NPM_CONFIG_USERCONFIG"; fi
} >> "$NPM_LOG"
if [[ "${1:-}" == "install" ]]; then
  mkdir -p node_modules/@wave-av/governance/bin
  cat > node_modules/@wave-av/governance/bin/enforce.mjs <<'JS'
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
const npmrc = (readFileSync(process.env.NPM_LOG, 'utf8').match(/^userconfig_path:(.+)$/m) || [])[1] || '';
appendFileSync(process.env.ENF_LOG, [
  `enforcer_argv:${process.argv.slice(2).join(' ')}`,
  `enforcer_token:${'WAVE_REGISTRY_READ_TOKEN' in process.env ? 'present' : 'absent'}`,
  `enforcer_legacy:${'NODE_AUTH_TOKEN' in process.env ? 'present' : 'absent'}`,
  `enforcer_url:${'WAVE_REGISTRY_URL' in process.env ? 'present' : 'absent'}`,
  `enforcer_userconfig_env:${'NPM_CONFIG_USERCONFIG' in process.env ? 'present' : 'absent'}`,
  `npmrc_exists_at_enforce:${npmrc && existsSync(npmrc) ? 'yes' : 'no'}`,
].join('\n') + '\n');
JS
fi
exit 0
STUB
chmod +x "$stubs/npm" "$stubs/node"

# run_step [VAR=value...]: governance-enforce on a main push build of wave-av/cli unless overridden.
run_step() {
  : > "$work/npm.log"
  : > "$work/enf.log"
  (cd "$repo" && env -i PATH="$stubs:/usr/bin:/bin" HOME="$work" TMPDIR="$work/tmp" REAL_NODE="$REAL_NODE" \
    NPM_LOG="$work/npm.log" ENF_LOG="$work/enf.log" STEP_REPO="$repo" EXPECT_TOKEN="$FAKE_TOKEN" \
    BUILDKITE_PULL_REQUEST=false BUILDKITE_BRANCH=main BUILDKITE_REPO="git@github.com:wave-av/cli.git" \
    "$@" bash .buildkite/scripts/governance-enforce.sh) > "$work/out" 2>&1
}
section() { awk -v p="--- argv:$1" 'index($0, p) == 1 { on = 1; next } /^--- argv:/ { on = 0 } on' "$work/npm.log"; }
has() { grep -qxF -- "$1" <<< "$2"; }

# --- 2. a main build -----------------------------------------------------------------------------------
gov_version="$(sed -n 's/^GOVERNANCE_VERSION="\([0-9.]*\)"$/\1/p' "$ROOT/.buildkite/scripts/governance-enforce.sh")"
rc=0
run_step WAVE_REGISTRY_READ_TOKEN="$FAKE_TOKEN" WAVE_REGISTRY_URL="$URL" NODE_AUTH_TOKEN=legacy-value-not-real || rc=$?
inst="$(section install)"
enf_log="$(cat "$work/enf.log")"
if [[ $rc -eq 0 ]]; then ok "governance-enforce exits 0 with the registry token and URL"; else bad "governance-enforce exits 0 with the registry token and URL (exit $rc)"; sed 's/^/    | /' "$work/out"; fi
if [[ -n "$gov_version" ]] && grep -qF -- "--- argv:install @wave-av/governance@${gov_version} " "$work/npm.log" &&
  [[ "$(grep -c '^--- argv:' "$work/npm.log")" -eq 1 ]]; then ok "npm runs once: install exactly @wave-av/governance@${gov_version}"; else bad "npm runs once: install exactly @wave-av/governance@${gov_version}"; fi
if grep "^--- argv:install" "$work/npm.log" | grep -q -- "--ignore-scripts"; then ok "the install runs with --ignore-scripts"; else bad "the install runs with --ignore-scripts"; fi
if has "cwd_in_repo:no" "$inst"; then ok "the install is outside the checkout"; else bad "the install is outside the checkout"; fi
if has "globalconfig:/dev/null" "$inst"; then ok "the install uses a null global npmrc"; else bad "the install uses a null global npmrc"; fi
if has "extra_ca:$CA" "$inst"; then ok "the install trusts the registry CA"; else bad "the install trusts the registry CA"; fi
if has "npmrc:@wave-av:registry=$URL" "$inst"; then ok "the job npmrc maps @wave-av to WAVE_REGISTRY_URL"; else bad "the job npmrc maps @wave-av to WAVE_REGISTRY_URL"; fi
if has "npmrc://${URL#https://}:_authToken=\${WAVE_REGISTRY_READ_TOKEN}" "$inst"; then ok "the job npmrc carries the token placeholder, not the value"; else bad "the job npmrc carries the token placeholder, not the value"; fi
if [[ "$(grep -c "^npmrc:" <<< "$inst")" -eq 2 ]]; then ok "the job npmrc has exactly those two lines"; else bad "the job npmrc has exactly those two lines"; fi
if has "userconfig_mode:600" "$inst"; then ok "the job npmrc is mode 600"; else bad "the job npmrc is mode 600"; fi
if has "token_env:set" "$inst" && has "token_matches:yes" "$inst"; then ok "npm gets the registry token (the host value, unchanged)"; else bad "npm gets the registry token (the host value, unchanged)"; fi
if has "legacy_env:unset" "$inst" && has "url_env:unset" "$inst"; then ok "npm sees neither NODE_AUTH_TOKEN nor the WAVE_REGISTRY_URL env"; else bad "npm sees neither NODE_AUTH_TOKEN nor the WAVE_REGISTRY_URL env"; fi
if ! grep -q "npm\.pkg\.github\.com" "$work/npm.log"; then ok "nothing names npm.pkg.github.com in npm's config"; else bad "nothing names npm.pkg.github.com in npm's config"; fi
if grep -qE "^enforcer_argv:--changed [0-9a-f]{40}$" <<< "$enf_log"; then ok "the enforcer runs on the diff (--changed <base>)"; else bad "the enforcer runs on the diff (--changed <base>)"; fi
if has "enforcer_token:absent" "$enf_log" && has "enforcer_legacy:absent" "$enf_log" && has "enforcer_url:absent" "$enf_log"; then ok "the enforcer runs without the token, the legacy name or the URL"; else bad "the enforcer runs without the token, the legacy name or the URL"; fi
if has "enforcer_userconfig_env:absent" "$enf_log" && has "npmrc_exists_at_enforce:no" "$enf_log"; then ok "the npmrc is gone before the enforcer runs"; else bad "the npmrc is gone before the enforcer runs"; fi
if ! grep -qF -- "$FAKE_TOKEN" "$work/out"; then ok "the token value is never printed"; else bad "the token value is never printed"; fi
rc=0
run_step WAVE_REGISTRY_READ_TOKEN="$FAKE_TOKEN" WAVE_REGISTRY_URL="https://registry.example.invalid/" || rc=$?
if [[ $rc -eq 0 ]] && has "npmrc://registry.example.invalid/:_authToken=\${WAVE_REGISTRY_READ_TOKEN}" "$(section install)"; then ok "a URL without a port works too"; else bad "a URL without a port works too (exit $rc)"; fi

# --- 3. refusals ---------------------------------------------------------------------------------------
# refuses <name> <expected stderr text> [VAR=value...]: exit 1, npm never ran, the message, no token value.
refuses() {
  local name="$1" want="$2" rc=0
  shift 2
  run_step "$@" || rc=$?
  if [[ $rc -eq 1 ]] && ! grep -q '^--- argv:' "$work/npm.log" && grep -qF -- "$want" "$work/out" && ! grep -qF -- "$FAKE_TOKEN" "$work/out"; then
    ok "refuses before npm: $name"
  else bad "refuses before npm: $name (exit $rc)"; sed 's/^/    | /' "$work/out"; fi
}
refuses "no token (the public-repo default)" "WAVE_REGISTRY_READ_TOKEN is not set" WAVE_REGISTRY_URL="$URL"
refuses "only the retired NODE_AUTH_TOKEN" "WAVE_REGISTRY_READ_TOKEN is not set" NODE_AUTH_TOKEN="$FAKE_TOKEN" WAVE_REGISTRY_URL="$URL"
refuses "no URL" "WAVE_REGISTRY_URL is not set" WAVE_REGISTRY_READ_TOKEN="$FAKE_TOKEN"
for bad_url in "http://registry.example.invalid/" "https://registry.example.invalid" "https://registry.example.invalid/path/" \
  "https://user:pw@registry.example.invalid/" "https://registry.example.invalid/?a=b" \
  $'https://registry.example.invalid/\nregistry=https://evil.example/' "https://REGISTRY.example.invalid/"; do
  refuses "URL $(printf '%q' "$bad_url")" "WAVE_REGISTRY_URL is not set or is not an https origin" WAVE_REGISTRY_READ_TOKEN="$FAKE_TOKEN" WAVE_REGISTRY_URL="$bad_url"
done
refuses "a PR from another repository" "refusing to use a credential for a PR from another repository" \
  WAVE_REGISTRY_READ_TOKEN="$FAKE_TOKEN" WAVE_REGISTRY_URL="$URL" BUILDKITE_PULL_REQUEST=7 \
  BUILDKITE_PULL_REQUEST_BASE_BRANCH=main BUILDKITE_PULL_REQUEST_REPO="https://github.com/someone/fork.git"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
