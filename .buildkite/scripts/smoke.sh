#!/usr/bin/env bash
# Step `smoke`: smoke-install.yml `smoke`. Builds and packs the tarball, installs it into a throwaway
# project from the real registry exactly as a user would, then checks that `wave --version` and the
# help banner both report the package.json version.
#
# Differences from GH: runs on the one Node the build image provides (asserted 22); the GH matrix also
# ran Node 20. The live `wave status` / `wave doctor` reachability check needs an API key and is not
# part of this pipeline. No credential.
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

cd "$BK_REPO_ROOT"
bk_assert_node_major 22
bk_npm_ci_public

bk_section "build"
npm run build

work=""
bk_mktemp_dir work
bk_section "pack tarball"
npm pack --pack-destination "$work"
tarball="$(find "$work" -maxdepth 1 -name 'wave-av-cli-*.tgz' -print -quit)"
[[ -n "$tarball" ]] || { bk_err "npm pack produced no wave-av-cli-*.tgz"; exit 1; }

bk_section "fresh install from the packed tarball (real registry, real deps)"
mkdir -p "${work}/smoke"
cd "${work}/smoke"
# An empty per-user npm config: resolve exactly as a first-time user's install would (public registry
# for every scope), whatever npm config the build machine carries.
: > "${work}/empty-npmrc"
export NPM_CONFIG_USERCONFIG="${work}/empty-npmrc"
npm init -y >/dev/null
npm i "$tarball" --no-audit --no-fund

bk_section "wave --version / help banner match package.json"
expected="$(node -p 'require(process.argv[1]).version' "${BK_REPO_ROOT}/package.json")"
actual="$(npx --no-install wave --version | tr -d '[:space:]')"
printf 'package.json=%s  wave --version=%s\n' "$expected" "$actual"
if [[ "$actual" != "$expected" ]]; then
  bk_err "installed CLI reports '${actual}' but package.json says '${expected}'"
  exit 1
fi

# The CLI suppresses its banner under CI and agent environments, so clear every variable it keys on;
# otherwise this would compare against a banner that was never printed.
help="$(env -u CI -u GITHUB_ACTIONS -u VERCEL -u BUILDKITE -u GITLAB_CI -u CIRCLECI \
  -u WAVE_AGENT -u CLAUDE_CODE -u CURSOR_SESSION -u AIDER_SESSION -u CONTINUE_SESSION \
  npx --no-install wave --help 2>&1)"
banner="$(printf '%s' "$help" | sed 's/\x1b\[[0-9;]*m//g' | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+[^[:space:]]*' | head -n1 || true)"
if [[ "$banner" != "v${expected}" ]]; then
  bk_err "help banner reported '${banner:-<no version in banner>}', expected 'v${expected}'"
  printf '%s\n' "$help" | head -n 20
  exit 1
fi
printf 'package.json == --version == banner == %s\n' "$expected"
