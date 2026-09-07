#!/usr/bin/env bash
# check-VER-001.sh — "every shipped component resolves to one source revision and version; no
# newer source is represented as deployed; CLI banner agrees."
#
# Cross-checks FIVE independent version facts for @wave-av/cli:
#   1. package.json version at the checked-out HEAD
#   2. the newest `v*` tag on origin
#   3. the GitHub release for that tag (if one exists)
#   4. the npm dist-tag `latest` on the PUBLIC registry (registry.npmjs.org, no auth)
#   5. the BUILT CLI's own `--version` output, built from HEAD in this worktree
#
# Registry and GitHub API reads are unauthenticated and read-only; nothing here installs,
# publishes or mutates anything. The build step runs `npm ci` + the package's own `build`
# script against the PUBLIC npm registry, with an isolated npm user-config so an ambient
# `@wave-av:registry` override on the runner (e.g. a private GitHub Packages scope) cannot
# quietly substitute a different artifact than what a real `npm install` from HEAD would use.
#
# HONESTY CARVE-OUT (explicit, and ONLY this one): a pull_request that bumps package.json
# ahead of what npm currently serves as `latest` is a legitimate pre-release state (the PR
# IS the release). That specific disagreement — HEAD strictly newer than npm `latest` — is
# reported UNKNOWN ("unreleased source"), never FAIL. Every other disagreement (tag doesn't
# match HEAD, no GitHub release for the newest tag, release version doesn't match its own tag,
# built CLI disagrees with package.json, or npm `latest` is AHEAD of HEAD — i.e. something is
# already deployed that HEAD cannot account for) is a real, verifiable FAIL.
#
# OUTPUT: one line per check, exactly `PASS|FAIL|UNKNOWN <check-name>: <detail>` on stdout,
# plus `TARGET <id>` lines naming the concrete package/tag versions this run observed.
#
# EXIT CODES
#   0  every printed check is PASS (UNKNOWN lines, if any, are the sole exception — see above)
#   1  at least one check is a real FAIL
#   2  the check could not run at all (missing tool, unreachable registry/API, unreadable repo)
#
# ENV (all optional; used to prove the gate can fail — see the PR body's broken-input receipt)
#   GA_VER001_NPM_PACKAGE   override the npm package name queried (default: package.json name)
#   GA_VER001_GITHUB_REPO   override the GitHub repo queried for tags/releases (default: wave-av/cli)
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || { echo "UNKNOWN setup: cannot cd to repo root $REPO_ROOT"; exit 2; }

NPM_REGISTRY="https://registry.npmjs.org"
GITHUB_API="https://api.github.com"
GITHUB_REPO="${GA_VER001_GITHUB_REPO:-wave-av/cli}"
FAIL_COUNT=0

emit() { printf '%s\n' "$1"; }
note_fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); }

command -v node >/dev/null 2>&1 || { emit "UNKNOWN setup: node not found on PATH"; exit 2; }
command -v git  >/dev/null 2>&1 || { emit "UNKNOWN setup: git not found on PATH"; exit 2; }
command -v curl >/dev/null 2>&1 || { emit "UNKNOWN setup: curl not found on PATH"; exit 2; }
[ -f package.json ] || { emit "UNKNOWN setup: package.json not found at repo root ($REPO_ROOT)"; exit 2; }

# --- 1. HEAD facts -----------------------------------------------------------------------
REVISION="$(git rev-parse HEAD 2>/dev/null)" || { emit "UNKNOWN setup: git rev-parse HEAD failed"; exit 2; }

PKG_INFO="$(node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const bin = typeof pkg.bin === "string" ? pkg.bin : (pkg.bin && (pkg.bin.wave || Object.values(pkg.bin)[0]));
if (!pkg.name || !pkg.version) { console.error("package.json is missing name or version"); process.exit(1); }
if (!bin) { console.error("package.json declares no usable bin entry"); process.exit(1); }
console.log(JSON.stringify({ name: pkg.name, version: pkg.version, bin }));
' 2>&1)" || { emit "UNKNOWN setup: cannot read package.json ($PKG_INFO)"; exit 2; }

HEAD_NAME="$(node -e "console.log(JSON.parse(process.argv[1]).name)" "$PKG_INFO")"
HEAD_VERSION="$(node -e "console.log(JSON.parse(process.argv[1]).version)" "$PKG_INFO")"
BIN_REL="$(node -e "console.log(JSON.parse(process.argv[1]).bin)" "$PKG_INFO")"
NPM_PACKAGE="${GA_VER001_NPM_PACKAGE:-$HEAD_NAME}"

emit "TARGET ${HEAD_NAME}@${HEAD_VERSION}"

# --- 2. newest v* tag on origin -----------------------------------------------------------
TAG_LIST="$(git ls-remote --tags --refs origin 'v*' 2>&1)"
if [ $? -ne 0 ]; then
  emit "UNKNOWN setup: git ls-remote --tags origin failed: ${TAG_LIST}"
  exit 2
fi
NEWEST_TAG="$(printf '%s\n' "$TAG_LIST" | sed -E 's#.*refs/tags/##' | sed -E 's/^v//' \
  | grep -E '^[0-9]+\.[0-9]+\.[0-9]+' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)"
if [ -z "$NEWEST_TAG" ]; then
  emit "FAIL tag-matches-head-version: origin carries no v* semver tag to compare against HEAD (${HEAD_VERSION})"
  note_fail
  TAG_VERSION=""
else
  TAG_VERSION="$NEWEST_TAG"
  emit "TARGET ${HEAD_NAME}@tag-v${TAG_VERSION}"
  if [ "$TAG_VERSION" = "$HEAD_VERSION" ]; then
    emit "PASS tag-matches-head-version: newest tag v${TAG_VERSION} matches HEAD package.json version ${HEAD_VERSION}"
  else
    emit "FAIL tag-matches-head-version: newest origin tag is v${TAG_VERSION} but HEAD package.json version is ${HEAD_VERSION}"
    note_fail
  fi
fi

# --- 3. GitHub release for that tag ---------------------------------------------------------
if [ -n "$TAG_VERSION" ]; then
  AUTH_HEADER=()
  [ -n "${GITHUB_TOKEN:-}" ] && AUTH_HEADER=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  REL_HTTP_CODE_FILE="$(mktemp)"
  # Deliberately no `-f`: a 404 here is an expected, meaningful DATA outcome ("no release for
  # this tag"), not a transport failure, and must be read as a body + status code rather than
  # treated as a curl error. `-f` interacting with `-w` on an HTTP/2 404 has also been observed
  # to make curl exit 56 ("user callback function failed") on some libcurl/nghttp2 builds —
  # another reason to just read the status code ourselves instead of asking curl to fail on it.
  REL_HTTP_CODE="$(curl -sS "${AUTH_HEADER[@]}" -H "Accept: application/vnd.github+json" \
    -w '%{http_code}' -o "${REL_HTTP_CODE_FILE}.body" \
    "${GITHUB_API}/repos/${GITHUB_REPO}/releases/tags/v${TAG_VERSION}" 2>"${REL_HTTP_CODE_FILE}.err")"
  REL_CURL_STATUS=$?
  if [ "$REL_CURL_STATUS" -ne 0 ]; then
    emit "UNKNOWN setup: could not reach GitHub releases API for ${GITHUB_REPO} (curl exit ${REL_CURL_STATUS}: $(tr '\n' ' ' < "${REL_HTTP_CODE_FILE}.err"))"
    rm -f "${REL_HTTP_CODE_FILE}" "${REL_HTTP_CODE_FILE}.body" "${REL_HTTP_CODE_FILE}.err"
    exit 2
  fi
  if [ "$REL_HTTP_CODE" = "404" ]; then
    emit "FAIL github-release-matches-tag: no GitHub release found at tag v${TAG_VERSION} in ${GITHUB_REPO} (release ledger is incomplete for the newest tag)"
    note_fail
  else
    REL_TAG_NAME="$(node -e '
      const fs = require("fs");
      try {
        const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        console.log(body.tag_name || "");
      } catch { console.log(""); }
    ' "${REL_HTTP_CODE_FILE}.body")"
    REL_VERSION="${REL_TAG_NAME#v}"
    emit "TARGET ${HEAD_NAME}@release-${REL_TAG_NAME}"
    if [ "$REL_VERSION" = "$TAG_VERSION" ]; then
      emit "PASS github-release-matches-tag: GitHub release ${REL_TAG_NAME} matches the newest tag v${TAG_VERSION}"
    else
      emit "FAIL github-release-matches-tag: GitHub release at tag v${TAG_VERSION} reports tag_name=${REL_TAG_NAME:-<empty>}"
      note_fail
    fi
  fi
  rm -f "${REL_HTTP_CODE_FILE}" "${REL_HTTP_CODE_FILE}.body" "${REL_HTTP_CODE_FILE}.err"
fi

# --- 4. npm dist-tag `latest` on the public registry (unauthenticated, read-only) -----------
NPM_URL="${NPM_REGISTRY}/$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$NPM_PACKAGE")/latest"
NPM_BODY_FILE="$(mktemp)"
NPM_HTTP_CODE="$(curl -fsS -w '%{http_code}' -o "$NPM_BODY_FILE" "$NPM_URL" 2>/dev/null)"
NPM_CURL_STATUS=$?
if [ "$NPM_CURL_STATUS" -ne 0 ]; then
  emit "UNKNOWN setup: could not reach public npm registry for ${NPM_PACKAGE} (${NPM_URL}, curl exit ${NPM_CURL_STATUS})"
  rm -f "$NPM_BODY_FILE"
  exit 2
fi
NPM_LATEST="$(node -e '
  const fs = require("fs");
  try {
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    console.log(d.version || "");
  } catch { console.log(""); }
' "$NPM_BODY_FILE")"
rm -f "$NPM_BODY_FILE"
if [ -z "$NPM_LATEST" ]; then
  emit "UNKNOWN setup: registry served no resolvable version for ${NPM_PACKAGE} dist-tag latest"
  exit 2
fi
emit "TARGET ${NPM_PACKAGE}@${NPM_LATEST}"

SEMVER_CMP="$(node -e '
  const [a, b] = [process.argv[1], process.argv[2]].map((v) =>
    String(v).split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0));
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) { console.log(a[i] < b[i] ? "-1" : "1"); process.exit(0); } }
  console.log("0");
' "$NPM_LATEST" "$HEAD_VERSION")"

EVENT_NAME="${GITHUB_EVENT_NAME:-manual}"
if [ "$SEMVER_CMP" = "0" ]; then
  emit "PASS npm-latest-matches-head: npm dist-tag latest (${NPM_LATEST}) matches HEAD package.json version (${HEAD_VERSION})"
elif [ "$SEMVER_CMP" = "-1" ]; then
  emit "UNKNOWN npm-latest-matches-head: npm dist-tag latest (${NPM_LATEST}) is behind HEAD package.json version (${HEAD_VERSION}) — unreleased source (event: ${EVENT_NAME}); this is the legitimate release-PR carve-out, not a failure"
else
  emit "FAIL npm-latest-matches-head: npm dist-tag latest (${NPM_LATEST}) is AHEAD of HEAD package.json version (${HEAD_VERSION}) — a deployed artifact has no matching source revision at HEAD"
  note_fail
fi

# --- 5. built CLI --version, built from HEAD in this worktree -------------------------------
BUILD_LOG="$(mktemp)"
NPM_ISOLATION_DIR="$(mktemp -d)"
printf 'registry=%s/\n@wave-av:registry=%s/\naudit=false\nfund=false\nupdate-notifier=false\n' \
  "$NPM_REGISTRY" "$NPM_REGISTRY" > "${NPM_ISOLATION_DIR}/npm-userconfig"
: > "${NPM_ISOLATION_DIR}/npm-globalconfig"
(
  export npm_config_userconfig="${NPM_ISOLATION_DIR}/npm-userconfig"
  export npm_config_globalconfig="${NPM_ISOLATION_DIR}/npm-globalconfig"
  export npm_config_registry="${NPM_REGISTRY}/"
  npm ci --include=dev --no-audit --no-fund --loglevel=error && npm run build --silent
) >"$BUILD_LOG" 2>&1
BUILD_STATUS=$?
rm -rf "$NPM_ISOLATION_DIR"

if [ "$BUILD_STATUS" -ne 0 ]; then
  emit "UNKNOWN setup: could not build HEAD (npm ci / npm run build failed, exit ${BUILD_STATUS}): $(tail -c 500 "$BUILD_LOG" | tr '\n' ' ')"
  rm -f "$BUILD_LOG"
  exit 2
fi
rm -f "$BUILD_LOG"

if [ ! -f "$BIN_REL" ]; then
  emit "FAIL built-cli-version-matches-package: build succeeded but declared bin '${BIN_REL}' does not exist"
  note_fail
else
  BUILT_VERSION_RAW="$(node "$BIN_REL" --version 2>&1)"
  BUILT_STATUS=$?
  BUILT_VERSION="$(printf '%s' "$BUILT_VERSION_RAW" | tr -d '[:space:]' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+[^[:space:]]*' | head -1)"
  if [ "$BUILT_STATUS" -ne 0 ]; then
    emit "FAIL built-cli-version-matches-package: \`node ${BIN_REL} --version\` exited ${BUILT_STATUS}: $(printf '%s' "$BUILT_VERSION_RAW" | tr '\n' ' ' | head -c 300)"
    note_fail
  elif [ "$BUILT_VERSION" = "$HEAD_VERSION" ]; then
    emit "PASS built-cli-version-matches-package: built CLI \`--version\` prints ${BUILT_VERSION}, matching package.json (${HEAD_VERSION})"
  else
    emit "FAIL built-cli-version-matches-package: VERSION LIE — package.json is ${HEAD_VERSION} but the built CLI's \`--version\` prints ${BUILT_VERSION:-<unparseable: $BUILT_VERSION_RAW>}"
    note_fail
  fi
fi

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
