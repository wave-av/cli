#!/usr/bin/env bash
# guards.test.sh: self-contained tests for the Buildkite guard scripts.
#
#   bash .buildkite/tests/guards.test.sh [SRC_ROOT]
#
# SRC_ROOT (default: this checkout) must hold .buildkite/scripts and scripts/public-repo-guard; pass
# an older extracted tree to see which tests the old code fails. Needs bash 4.4+, git, ripgrep with
# PCRE2, tar, find, sed, seq. No network and no real credential: every repository is a temp fixture
# with a local bare "origin", gitleaks is a shim, and secret-shaped strings are assembled at run
# time so this file never holds one. HOME and git's global config point into the temp dir.
#
# Covers: the trust rule and trusted handoff of guard-gitleaks and guard-content-policy (PR,
# non-default branch, tag, HEAD not on the default branch); each fail-closed environment check;
# the gitleaks scan-copy cleaning; content and path-name allow markers in the content policy; the
# secret scan's content-only exemptions; and the file-size gate's symlink refusal.
set -uo pipefail

SRC="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SRC="$(cd "$SRC" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/guards-test.XXXXXX" 2>/dev/null || mktemp -d /tmp/guards-test.XXXXXX)" || { echo "cannot create a temp dir"; exit 2; }
if [[ -z "$T" || ! -d "$T" ]]; then echo "cannot create a temp dir"; exit 2; fi
T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home" "$T/tmp" "$T/bin-nopcre" || exit 2
# mktemp_in PREFIX: a fresh dir under $T, or abort the whole run (never an empty path).
mktemp_in() {
  local d
  d="$(mktemp -d "$T/$1.XXXXXX")" || { echo "cannot create $1 under the test dir"; exit 2; }
  [[ -n "$d" && "$d" == "$T"/* ]] || { echo "bad temp path"; exit 2; }
  printf '%s' "$d"
}

pass=0
fail=0
ok() { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf 'FAIL %s\n' "$1"; sed 's/^/    | /' "$T/out" 2>/dev/null | head -n 8; }
expect_rc() { if [[ "$RC" == "$2" ]]; then ok "$1"; else bad "$1 (exit $RC, want $2)"; fi; }
expect_out() { if grep -qF -- "$2" "$T/out"; then ok "$1"; else bad "$1 (missing: $2)"; fi; }
expect_no_out() { if ! grep -qF -- "$2" "$T/out"; then ok "$1"; else bad "$1 (unexpected: $2)"; fi; }
expect_line() { if grep -qxF -- "$2" "$T/out"; then ok "$1"; else bad "$1 (no line: $2)"; fi; }

# Secret-shaped values, assembled so this file never contains one.
KEY="AKIA""ABCDEFGHIJKLMNOP"
ACCT="acct_""ABCDEFGHIJKLMNOPQRST"
MARK_ALLOW="guard"":allow"

REAL_RG="$(command -v rg)" || { echo "ripgrep is required"; exit 2; }
cat > "$T/gitconfig" <<'CFG'
[user]
	name = t
	email = t@example.invalid
[core]
	hooksPath = /dev/null
[init]
	defaultBranch = main
[commit]
	gpgsign = false
[advice]
	detachedHead = false
CFG
BASE=(PATH="$PATH" HOME="$T/home" TMPDIR="$T/tmp" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$T/gitconfig" LC_ALL=C)
REPO_URL="git@github.com:example/cli.git"
BK=(BUILDKITE=true BUILDKITE_PIPELINE_DEFAULT_BRANCH=main BUILDKITE_REPO="$REPO_URL")
# g: git with the isolated config. It refuses any repository path outside the test dir, so a bug
# can never run git in the checkout that holds this file.
g() {
  local target=""
  if [[ "${1:-}" == "-C" ]]; then target="${2:-}"; elif [[ "${1:-}" == "init" ]]; then target="${*: -1}"; fi
  if [[ -z "$target" || "$target" != "$T"/* ]]; then
    echo "test bug: refusing git outside the test dir ($*)" >&2
    exit 2
  fi
  env -i "${BASE[@]}" git "$@"
}

# run DIR [VAR=value...] -- CMD...: runs CMD in DIR with ONLY the base and given variables. Sets RC.
run() {
  local dir="$1"; shift
  local -a vars=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do vars+=("$1"); shift; done
  shift
  RC=0
  (cd "$dir" && env -i "${BASE[@]}" "${vars[@]}" "$@") > "$T/out" 2>&1 || RC=$?
}

# mk_repo DIR: bare origin + clone whose main holds SRC's guard scripts and vendored policy.
mk_repo() {
  local d="$1"
  g init -q --bare "$d/origin.git"
  g init -q "$d/wt"
  mkdir -p "$d/wt/.buildkite" "$d/wt/scripts"
  cp -R "$SRC/.buildkite/scripts" "$d/wt/.buildkite/scripts"
  cp -R "$SRC/scripts/public-repo-guard" "$d/wt/scripts/public-repo-guard"
  printf 'hello\n' > "$d/wt/README.md"
  g -C "$d/wt" add -A
  g -C "$d/wt" commit -q -m base
  g -C "$d/wt" remote add origin "$d/origin.git"
  g -C "$d/wt" push -q origin main
}

# on_branch WT NAME FILE CONTENT: new branch off main with one added file (FILE may hold dirs).
on_branch() {
  g -C "$1" checkout -q main
  g -C "$1" checkout -q -b "$2"
  mkdir -p "$1/$(dirname "$3")"
  printf '%s\n' "$4" > "$1/$3"
  g -C "$1" add -A
  g -C "$1" commit -q -m "$2"
}

R="$T/r"
mk_repo "$R"
W="$R/wt"
GL=.buildkite/scripts/guard-gitleaks.sh
CP=.buildkite/scripts/guard-content-policy.sh

# --- guard-gitleaks: trust rule -------------------------------------------------------------------
# shellcheck disable=SC2016 # expanded by the inner bash, on purpose
gl_trust() { run "$W" "$@" -- bash -c 'source "$1"; if needs_trust; then echo STATE=untrusted; else echo STATE=trusted; fi' _ "$GL"; }
g -C "$W" checkout -q main
gl_trust "${BK[@]}" BUILDKITE_PULL_REQUEST=7 BUILDKITE_BRANCH=feature
expect_out "gitleaks: a PR build is untrusted" "STATE=untrusted"
gl_trust "${BK[@]}" BUILDKITE_PULL_REQUEST=false BUILDKITE_BRANCH=feature
expect_out "gitleaks: a push to a non-default branch is untrusted" "STATE=untrusted"
gl_trust "${BK[@]}" BUILDKITE_PULL_REQUEST=false BUILDKITE_BRANCH=main
expect_out "gitleaks: a default-branch build at the default-branch tip is trusted" "STATE=trusted"
gl_trust "${BK[@]}" BUILDKITE_PULL_REQUEST=false BUILDKITE_BRANCH=main BUILDKITE_TAG=v1
expect_out "gitleaks: a tagged default-branch build is untrusted" "STATE=untrusted"
on_branch "$W" side side.txt "side"
g -C "$W" checkout -q --detach side
gl_trust "${BK[@]}" BUILDKITE_PULL_REQUEST=false BUILDKITE_BRANCH=main
expect_out "gitleaks: branch=main with HEAD not on the default branch is untrusted" "STATE=untrusted"
g -C "$W" checkout -q main
gl_trust
expect_out "gitleaks: a local run outside Buildkite is trusted" "STATE=trusted"

# --- guard-gitleaks: fail-closed environment checks ----------------------------------------------
cat > "$T/gl-shim" <<'SHIM'
#!/usr/bin/env bash
{
  printf 'cwd=%s\n' "$PWD"
  printf 'args=%s\n' "$*"
  printf 'cfgenv=%s\n' "${GITLEAKS_CONFIG+set}${GITLEAKS_CONFIG_TOML+set}"
  printf 'leftover=%s\n' "$(find . \( -name .gitleaksignore -o -name .gitleaks.toml \) | wc -l | tr -d ' ')"
  ip=""; prev=""
  for a in "$@"; do if [[ "$prev" == "--gitleaks-ignore-path" ]]; then ip="$a"; fi; prev="$a"; done
  if [[ -f "$ip" ]]; then printf 'ignorepath_size=%s\n' "$(wc -c < "$ip" | tr -d ' ')"; else echo 'ignorepath_size=missing'; fi
} > "$GLLOG"
exit 0
SHIM
chmod +x "$T/gl-shim"
run "$W" "${BK[@]}" BUILDKITE_PULL_REQUEST=false BUILDKITE_BRANCH=main GITLEAKS_BIN="$T/gl-shim" GLLOG="$T/gl.log" -- bash "$GL"
expect_rc "gitleaks: GITLEAKS_BIN under Buildkite fails closed" 2
run "$W" BUILDKITE=true BUILDKITE_REPO="$REPO_URL" BUILDKITE_PULL_REQUEST=7 BUILDKITE_BRANCH=feature -- bash "$GL"
expect_rc "gitleaks: an untrusted build without a default branch fails closed" 2
run "$W" BUILDKITE=true BUILDKITE_REPO="$REPO_URL" BUILDKITE_PIPELINE_DEFAULT_BRANCH='bad..name' BUILDKITE_PULL_REQUEST=7 BUILDKITE_BRANCH=feature -- bash "$GL"
expect_rc "gitleaks: an invalid default branch name fails closed" 2
run "$W" -- bash "$GL" --trusted-work
expect_rc "gitleaks: --trusted-work without a directory fails closed" 2

# --- guard-gitleaks: trusted handoff ---------------------------------------------------------------
R2="$T/r2"
mk_repo "$R2"
W2="$R2/wt"
cat > "$W2/$GL" <<'STUB'
#!/usr/bin/env bash
printf 'TRUSTED-COPY-RAN %s\n' "$*" > "$MARKFILE"
STUB
g -C "$W2" commit -q -am "stub trusted copy"
g -C "$W2" push -q origin main
g -C "$W2" checkout -q -b pr
cp "$SRC/$GL" "$W2/$GL"
g -C "$W2" commit -q -am "pr copy"
run "$W2" "${BK[@]}" BUILDKITE_PULL_REQUEST=7 BUILDKITE_BRANCH=pr MARKFILE="$T/mark1" -- bash "$GL"
if grep -q 'TRUSTED-COPY-RAN --trusted-work' "$T/mark1" 2>/dev/null; then ok "gitleaks: a PR build hands off to the default branch's copy"; else bad "gitleaks: a PR build hands off to the default branch's copy"; fi
run "$W2" "${BK[@]}" BUILDKITE_PULL_REQUEST=false BUILDKITE_BRANCH=pr MARKFILE="$T/mark2" -- bash "$GL"
if grep -q 'TRUSTED-COPY-RAN --trusted-work' "$T/mark2" 2>/dev/null; then ok "gitleaks: a non-default branch build hands off to the default branch's copy"; else bad "gitleaks: a non-default branch build hands off to the default branch's copy"; fi

# --- guard-gitleaks: scan-copy cleaning ------------------------------------------------------------
F="$T/fixture-tree"
mkdir -p "$F/sub" "$T/gw"
printf 'x\n' > "$F/.gitleaksignore"
printf 'x\n' > "$F/sub/.gitleaksignore"
printf '[extend]\nuseDefault = false\n' > "$F/.gitleaks.toml"
printf '[extend]\nuseDefault = false\n' > "$F/sub/.gitleaks.toml"
printf 'token = "%s" # gitleaks:allow\n' "$KEY" > "$F/sub/code.txt"
printf '[extend]\nuseDefault = true\n' > "$T/trusted.toml"
# shellcheck disable=SC2016 # expanded by the inner bash, on purpose
run "$F" "${BK[@]}" GITLEAKS_CONFIG=/nonexistent/evil.toml GLLOG="$T/gl.log" WORKDIR="$T/gw" -- \
  bash -c 'source "$1"; WORK="$WORKDIR"; scan_untrusted_copy "$2" "$3"' _ "$SRC/$GL" "$T/gl-shim" "$T/trusted.toml"
cp "$T/gl.log" "$T/out" 2>/dev/null || : > "$T/out"
expect_out "gitleaks copy: the scan runs inside the copy" "cwd=$T/gw/tree"
expect_out "gitleaks copy: no .gitleaksignore or .gitleaks.toml survives in the copy" "leftover=0"
expect_out "gitleaks copy: gitleaks:allow lines are ignored (--ignore-gitleaks-allow)" "--ignore-gitleaks-allow"
expect_out "gitleaks copy: the trusted config is passed explicitly" "--config $T/trusted.toml"
expect_out "gitleaks copy: the ignore path is an empty file" "ignorepath_size=0"
expect_line "gitleaks copy: the config environment variables are unset" "cfgenv="
if [[ -f "$F/.gitleaksignore" && -f "$F/sub/.gitleaks.toml" ]]; then ok "gitleaks copy: the original tree is untouched"; else bad "gitleaks copy: the original tree is untouched"; fi

# --- guard-content-policy ----------------------------------------------------------------------------
PRV=(BUILDKITE_PULL_REQUEST_REPO="$REPO_URL")
TRUSTED_LINE="running the 'main' copy of this wrapper (trusted stage)"
g -C "$W" checkout -q main
run "$W" "${BK[@]}" BUILDKITE_PULL_REQUEST=false BUILDKITE_BRANCH=main -- bash "$CP"
expect_rc "content policy: a trusted default-branch build passes" 0
expect_no_out "content policy: a trusted default-branch build runs this checkout's policy" "$TRUSTED_LINE"
on_branch "$W" pr-clean clean.txt "nothing to see"
run "$W" "${BK[@]}" "${PRV[@]}" BUILDKITE_PULL_REQUEST=7 BUILDKITE_BRANCH=pr-clean WAVE_JOB_GUARD_PR=1 -- bash "$CP"
expect_out "content policy: a PR build hands off to the default branch's wrapper" "$TRUSTED_LINE"
expect_rc "content policy: a clean PR passes" 0
run "$W" "${BK[@]}" BUILDKITE_PULL_REQUEST=false BUILDKITE_BRANCH=pr-clean -- bash "$CP"
expect_out "content policy: a non-default branch build hands off" "$TRUSTED_LINE"
g -C "$W" checkout -q main
run "$W" "${BK[@]}" BUILDKITE_PULL_REQUEST=false BUILDKITE_BRANCH=main BUILDKITE_TAG=v1 -- bash "$CP"
expect_out "content policy: a tagged default-branch build hands off" "$TRUSTED_LINE"
g -C "$W" checkout -q --detach side
run "$W" "${BK[@]}" BUILDKITE_PULL_REQUEST=false BUILDKITE_BRANCH=main -- bash "$CP"
expect_out "content policy: branch=main with HEAD not on the default branch hands off" "$TRUSTED_LINE"

on_branch "$W" pr-content leak.txt "$ACCT # $MARK_ALLOW reason"
run "$W" "${BK[@]}" "${PRV[@]}" BUILDKITE_PULL_REQUEST=7 BUILDKITE_BRANCH=pr-content WAVE_JOB_GUARD_PR=1 -- bash "$CP"
expect_rc "content policy: an allow marker in PR file content does not exempt the hit" 1
on_branch "$W" pr-path "# $MARK_ALLOW reason/leak.txt" "$ACCT"
run "$W" "${BK[@]}" "${PRV[@]}" BUILDKITE_PULL_REQUEST=7 BUILDKITE_BRANCH=pr-path WAVE_JOB_GUARD_PR=1 -- bash "$CP"
expect_rc "content policy: an allow marker in a PR path name fails closed" 2
run "$W" "${BK[@]}" BUILDKITE_PULL_REQUEST=false BUILDKITE_BRANCH=pr-path -- bash "$CP"
expect_rc "content policy: an allow marker in a path name fails closed on a branch build" 2

g -C "$W" checkout -q pr-clean
run "$W" "${BK[@]}" "${PRV[@]}" BUILDKITE_PULL_REQUEST=7 BUILDKITE_BRANCH=pr-clean WAVE_JOB_GUARD_PR=0 -- bash "$CP"
expect_rc "content policy: WAVE_JOB_GUARD_PR=0 fails closed" 2
run "$W" "${BK[@]}" BUILDKITE_PULL_REQUEST=false BUILDKITE_BRANCH=pr-clean WAVE_JOB_GUARD_PR=1 -- bash "$CP"
expect_rc "content policy: the PR flag without a PR number fails closed" 2
run "$W" "${BK[@]}" "${PRV[@]}" BUILDKITE_PULL_REQUEST=7 BUILDKITE_BRANCH=pr-clean WAVE_JOB_GUARD_PR=1 GUARD_PRIVATE_REPOS_03= -- bash "$CP"
expect_rc "content policy: any private-list name present fails closed" 2
run "$W" "${BK[@]}" BUILDKITE_PULL_REQUEST_REPO="git@github.com:someone/fork.git" BUILDKITE_PULL_REQUEST=7 BUILDKITE_BRANCH=pr-clean WAVE_JOB_GUARD_PR=1 -- bash "$CP"
expect_rc "content policy: a fork PR is refused" 2
cat > "$T/bin-nopcre/rg" <<SHIM
#!/usr/bin/env bash
if [[ "\${1:-}" == "--pcre2-version" ]]; then echo "PCRE2 is not available in this build of ripgrep."; exit 1; fi
exec "$REAL_RG" "\$@"
SHIM
chmod +x "$T/bin-nopcre/rg"
BASE_SAVED=("${BASE[@]}")
BASE=(PATH="$T/bin-nopcre:$PATH" "${BASE_SAVED[@]:1}")
g -C "$W" checkout -q main
run "$W" "${BK[@]}" BUILDKITE_PULL_REQUEST=false BUILDKITE_BRANCH=main -- bash "$CP"
expect_rc "content policy: ripgrep without PCRE2 fails closed" 2
BASE=("${BASE_SAVED[@]}")

# --- foundation-secret-scan: exemptions match content only -----------------------------------------
ss_case() { # ss_case NAME WANT_RC: runs the scan in a fresh tree prepared by the caller in $S
  run "$S" -- bash .buildkite/scripts/foundation-secret-scan.sh
  expect_rc "$1" "$2"
}
ss_tree() { S="$(mktemp_in ss)" || exit 2; mkdir -p "$S/.buildkite/scripts" "$S/.github"; cp "$SRC/.buildkite/scripts/foundation-secret-scan.sh" "$S/.buildkite/scripts/"; }
ss_tree; printf 'nothing\n' > "$S/a.txt"; ss_case "secret scan: a clean tree passes" 0
ss_tree; printf 'k = %s\n' "$KEY" > "$S/a.txt"; ss_case "secret scan: a key is caught" 1
ss_tree; printf 'k = %s # pragma: allowlist secret\n' "$KEY" > "$S/a.txt"; ss_case "secret scan: the pragma on the key line exempts it" 0
ss_tree; mkdir -p "$S/pragma: allowlist secret-dir"; printf 'k = %s\n' "$KEY" > "$S/pragma: allowlist secret-dir/a.txt"
ss_case "secret scan: the pragma in a directory name does not exempt a key" 1
ss_tree; mkdir -p "$S/leakdir"; printf 'k = %s\n' "$KEY" > "$S/leakdir/a.txt"; printf 'leakdir\n' > "$S/.github/.secret-allowlist"
ss_case "secret scan: an allowlist phrase matching only the path does not exempt a key" 1
ss_tree; printf 'k = %s fixture-ok\n' "$KEY" > "$S/a.txt"; printf 'fixture-ok\n' > "$S/.github/.secret-allowlist"
ss_case "secret scan: an allowlist phrase in the content exempts the line" 0

# --- foundation-file-size: symlinks are refused ----------------------------------------------------
fs_tree() {
  FS="$(mktemp_in fs)" || exit 2
  g init -q "$FS"
  mkdir -p "$FS/.buildkite/scripts" "$FS/src"
  cp "$SRC/.buildkite/scripts/foundation-file-size.sh" "$FS/.buildkite/scripts/"
  printf 'export const a = 1;\n' > "$FS/src/small.ts"
}
fs_tree; g -C "$FS" add -A; g -C "$FS" commit -q -m one
run "$FS" -- bash .buildkite/scripts/foundation-file-size.sh
expect_rc "file size: small files pass" 0
fs_tree; seq 900 > "$FS/big.txt"; ln -s ../big.txt "$FS/src/oversize.ts"; g -C "$FS" add -A; g -C "$FS" commit -q -m one
run "$FS" -- bash .buildkite/scripts/foundation-file-size.sh
expect_rc "file size: a symlinked source file to an oversized file fails" 1

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
