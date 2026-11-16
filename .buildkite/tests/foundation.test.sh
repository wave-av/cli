#!/usr/bin/env bash
# foundation.test.sh: self-contained tests for this repository's own Buildkite step scripts.
#
#   bash .buildkite/tests/foundation.test.sh [SRC_ROOT]
#
# SRC_ROOT (default: this checkout) must hold .buildkite/scripts; pass an older extracted tree to
# see which tests the old code fails. Needs bash 4.4+, git, awk, find, sed, seq and python3. The
# skill-validate cases also need PyYAML and are reported as skipped without it. No network and no
# real credential: every repository is a temp fixture, `buildkite-agent` is a shim, and
# secret-shaped strings are assembled at run time so this file never holds one. HOME and git's
# global config point into the temp folder.
#
# The two leak guards are not tested here: they are not in this repository. The shared CI kit
# injects them into the rendered pipeline and the build host runs them from its own pinned copy.
#
# Covers: the secret scan's content-only exemptions, its scan of UTF-16 files and its handling of
# blank allowlist lines; the file-size gate's symlink refusal and its count of an unterminated final
# line; verify-routes on wildcard-prefixed routes; skill-validate's duplicate-key check on indented
# frontmatter; and the upload bridge's byte comparison with the kit uploader.
set -uo pipefail

SRC="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SRC="$(cd "$SRC" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/foundation-test.XXXXXX" 2>/dev/null || mktemp -d /tmp/foundation-test.XXXXXX)" || { echo "cannot create a temp folder"; exit 2; }
if [[ -z "$T" || ! -d "$T" ]]; then echo "cannot create a temp folder"; exit 2; fi
T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home" "$T/tmp" "$T/bin" || exit 2
# mktemp_in PREFIX: a fresh folder under $T, or abort the whole run (never an empty path).
mktemp_in() {
  local d
  d="$(mktemp -d "$T/$1.XXXXXX")" || { echo "cannot create $1 under the test folder"; exit 2; }
  [[ -n "$d" && "$d" == "$T"/* ]] || { echo "bad temp path"; exit 2; }
  printf '%s' "$d"
}

pass=0
fail=0
skip=0
ok() { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf 'FAIL %s\n' "$1"; sed 's/^/    | /' "$T/out" 2>/dev/null | head -n 8; }
skipped() { skip=$((skip + 1)); printf 'skip %s\n' "$1"; }
expect_rc() { if [[ "$RC" == "$2" ]]; then ok "$1"; else bad "$1 (exit $RC, want $2)"; fi; }
expect_out() { if grep -qF -- "$2" "$T/out"; then ok "$1"; else bad "$1 (missing: $2)"; fi; }

# Secret-shaped value, assembled so this file never contains one.
KEY="AKIA""ABCDEFGHIJKLMNOP"

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
CFG
BASE=(PATH="$T/bin:$PATH" HOME="$T/home" TMPDIR="$T/tmp" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$T/gitconfig" LC_ALL=C)
# g: git with the isolated config. It refuses any repository path outside the test folder, so a
# bug can never run git in the checkout that holds this file.
g() {
  local target=""
  if [[ "${1:-}" == "-C" ]]; then target="${2:-}"; elif [[ "${1:-}" == "init" ]]; then target="${*: -1}"; fi
  if [[ -z "$target" || "$target" != "$T"/* ]]; then
    echo "test bug: refusing git outside the test folder ($*)" >&2
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
  (cd "$dir" && env -i "${BASE[@]}" ${vars[@]+"${vars[@]}"} "$@") > "$T/out" 2>&1 || RC=$?
}

# git_tree PREFIX SCRIPT: a fresh git repository under $T holding one script from SRC. Sets D.
git_tree() {
  D="$(mktemp_in "$1")" || exit 2
  g init -q "$D"
  mkdir -p "$D/.buildkite/scripts"
  cp "$SRC/.buildkite/scripts/$2" "$D/.buildkite/scripts/"
}
commit_all() { g -C "$D" add -A; g -C "$D" commit -q -m one; }

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
ss_case "secret scan: the pragma in a folder name does not exempt a key" 1
ss_tree; mkdir -p "$S/leakdir"; printf 'k = %s\n' "$KEY" > "$S/leakdir/a.txt"; printf 'leakdir\n' > "$S/.github/.secret-allowlist"
ss_case "secret scan: an allowlist phrase matching only the path does not exempt a key" 1
ss_tree; printf 'k = %s fixture-ok\n' "$KEY" > "$S/a.txt"; printf 'fixture-ok\n' > "$S/.github/.secret-allowlist"
ss_case "secret scan: an allowlist phrase in the content exempts the line" 0
# A key stored as UTF-16 holds NUL bytes, so `grep -I` calls the file binary and skips it.
enc() { python3 -c 'import sys; sys.stdout.buffer.write(bytes.fromhex(sys.argv[3]) + sys.argv[1].encode(sys.argv[2]))' "$@"; }
ss_tree; enc "k = $KEY"$'\n' utf-16-le "" > "$S/a.txt"; ss_case "secret scan: a key in UTF-16LE with no byte-order mark is caught" 1
ss_tree; enc "k = $KEY"$'\n' utf-16-le fffe > "$S/a.txt"; ss_case "secret scan: a key in UTF-16LE with a byte-order mark is caught" 1
ss_tree; enc "k = $KEY"$'\n' utf-16-be feff > "$S/a.txt"; ss_case "secret scan: a key in UTF-16BE with a byte-order mark is caught" 1
ss_tree; enc "k = $KEY # pragma: allowlist secret"$'\n' utf-16-le fffe > "$S/a.txt"
ss_case "secret scan: the pragma still exempts a UTF-16 key line" 0
ss_tree; printf 'k = %s\n' "$KEY" > "$S/a.txt"; printf 'fixture-ok\n\n' > "$S/.github/.secret-allowlist"
ss_case "secret scan: a blank allowlist line does not exempt every hit" 1
ss_tree; printf 'k = %s\n' "$KEY" > "$S/a.txt"; printf ' \t\n' > "$S/.github/.secret-allowlist"
ss_case "secret scan: a whitespace-only allowlist line does not exempt every hit" 1
ss_tree; printf 'k = %s fixture-ok\n' "$KEY" > "$S/a.txt"; printf '\nfixture-ok\n\n' > "$S/.github/.secret-allowlist"
ss_case "secret scan: a phrase next to blank allowlist lines still exempts its line" 0

# --- foundation-file-size: symlinks refused, unterminated last line counted ------------------------
FS=foundation-file-size.sh
git_tree fs "$FS"; mkdir -p "$D/src"; printf 'export const a = 1;\n' > "$D/src/small.ts"; commit_all
run "$D" -- bash ".buildkite/scripts/$FS"
expect_rc "file size: small files pass" 0
git_tree fs "$FS"; mkdir -p "$D/src"; seq 900 > "$D/big.txt"; ln -s ../big.txt "$D/src/oversize.ts"; commit_all
run "$D" -- bash ".buildkite/scripts/$FS"
expect_rc "file size: a symlinked source file to an oversized file fails" 1
git_tree fs "$FS"; mkdir -p "$D/src"; seq 800 > "$D/src/edge.py"; commit_all
run "$D" -- bash ".buildkite/scripts/$FS"
expect_rc "file size: exactly 800 newline-terminated lines pass" 0
git_tree fs "$FS"; mkdir -p "$D/src"; { seq 800; printf 'x = 1'; } > "$D/src/over.py"; commit_all
run "$D" -- bash ".buildkite/scripts/$FS"
expect_rc "file size: 800 lines plus an unterminated 801st fail" 1
expect_out "file size: the unterminated line is counted" "src/over.py has 801 lines"

# --- foundation-verify-routes: wildcard-prefixed routes are checked --------------------------------
VR=foundation-verify-routes.sh
vr_case() { # vr_case NAME WANT_RC ROUTE
  git_tree vr "$VR"; printf 'name = "w"\nroutes = ["%s"]\n' "$3" > "$D/wrangler.toml"; commit_all
  run "$D" -- bash ".buildkite/scripts/$VR"
  expect_rc "$1" "$2"
}
vr_case "verify routes: a plain production host passes" 0 "api.wave.online/*"
vr_case "verify routes: a banned -edge suffix fails" 1 "api-edge.wave.online/*"
vr_case "verify routes: a wildcard-prefixed -edge route fails" 1 "*-edge.wave.online/*"
vr_case "verify routes: a wildcard-prefixed wave- prefix fails" 1 "*wave-api.wave.online/*"
vr_case "verify routes: a wildcard-prefixed -staging suffix fails" 1 "*-staging.wave.online/*"
vr_case "verify routes: a wildcard subdomain route passes" 0 "*.wave.online/*"
git_tree vr "$VR"; printf 'routes = [\x27*-edge.wave.online/*\x27]\n' > "$D/wrangler.toml"; commit_all
run "$D" -- bash ".buildkite/scripts/$VR"
expect_rc "verify routes: a single-quoted wildcard -edge route fails" 1

# --- foundation-skill-validate: duplicate keys at any indentation ----------------------------------
SV=foundation-skill-validate.sh
# PyYAML may live in the caller's per-user site folder, which the isolated HOME hides. Pass only
# the folder that holds the caller's yaml package (read, never written).
YAML_PP="$(python3 -c 'import os, yaml; print(os.path.dirname(os.path.dirname(yaml.__file__)))' 2>/dev/null || true)"
SV_VARS=()
if [[ -n "$YAML_PP" ]]; then SV_VARS=(PYTHONPATH="$YAML_PP"); fi
sv_case() { # sv_case NAME WANT_RC FRONTMATTER (written under skills/demo/SKILL.md)
  git_tree sv "$SV"; mkdir -p "$D/skills/demo"
  printf -- '---\n%s\n---\nbody\n' "$3" > "$D/skills/demo/SKILL.md"; commit_all
  run "$D" ${SV_VARS[@]+"${SV_VARS[@]}"} -- bash ".buildkite/scripts/$SV"
  expect_rc "$1" "$2"
}
if [[ -n "$YAML_PP" ]]; then
  sv_case "skill validate: a valid frontmatter passes" 0 $'name: demo\ndescription: a demo'
  sv_case "skill validate: a column-zero duplicate key fails" 1 $'name: wrong\nname: demo\ndescription: d'
  sv_case "skill validate: an indented duplicate key fails" 1 $'  name: wrong\n  name: demo\n  description: d'
  expect_out "skill validate: the indented duplicate is named" "duplicate frontmatter keys: name"
  sv_case "skill validate: a nested duplicate key fails" 1 $'name: demo\ndescription: d\nhooks:\n  pre: a\n  pre: b'
else
  skipped "skill validate: PyYAML is not installed here (cases need it)"
fi
git_tree sv "$SV"; printf 'x\n' > "$D/README.md"; commit_all
run "$D" -- bash ".buildkite/scripts/$SV"
expect_rc "skill validate: no SKILL.md is a no-op" 0

# --- upload.sh: the bridge uploads only the kit's own uploader, byte for byte -----------------------
cat > "$T/bin/buildkite-agent" <<'SHIM'
#!/usr/bin/env bash
printf 'agent-args:'
printf ' %s' "$@"
printf '\n'
SHIM
chmod +x "$T/bin/buildkite-agent"
# A stand-in for the kit checkout the build host prepares: it holds the kit uploader, which is
# this checkout's pipeline.yml (the two are byte-identical by contract).
KIT="$(mktemp_in kit)" || exit 2
mkdir -p "$KIT/repo-kit/.buildkite"
cp "$SRC/.buildkite/pipeline.yml" "$KIT/repo-kit/.buildkite/pipeline.yml"
KIT_NOFILE="$(mktemp_in kitempty)" || exit 2
up_tree() { # up_tree: a checkout holding upload.sh and a copy of the kit uploader as pipeline.yml
  U="$(mktemp_in up)" || exit 2
  mkdir -p "$U/.buildkite/scripts"
  cp "$SRC/.buildkite/scripts/upload.sh" "$U/.buildkite/scripts/"
  cp "$SRC/.buildkite/pipeline.yml" "$U/.buildkite/pipeline.yml"
}
up_run() { run "$U" WAVE_CI_DIR="$KIT" -- bash .buildkite/scripts/upload.sh; }
up_tree; up_run
expect_rc "upload: the kit uploader is uploaded" 0
expect_out "upload: with no interpolation and parse warnings rejected" "agent-args: pipeline upload --no-interpolation --reject-parse-warnings"
up_tree; printf 'steps:\n  - command: .buildkite/wave-ci.sh\n  - command: .buildkite/scripts/other.sh\n' > "$U/.buildkite/pipeline.yml"; up_run
expect_rc "upload: a step running another script is refused" 2
up_tree; printf 'steps:\n  - command: .buildkite/wave-ci.sh\n  - plugins:\n      - x#v1: {}\n' > "$U/.buildkite/pipeline.yml"; up_run
expect_rc "upload: a plugin step is refused" 2
up_tree; printf 'steps:\n  - commands:\n      - .buildkite/wave-ci.sh\n' > "$U/.buildkite/pipeline.yml"; up_run
expect_rc "upload: a commands list is refused" 2
up_tree; printf 'steps: []\n' > "$U/.buildkite/pipeline.yml"; up_run
expect_rc "upload: a pipeline with no step is refused" 2
up_tree; rm "$U/.buildkite/pipeline.yml"; up_run
expect_rc "upload: a missing pipeline.yml is refused" 2
# The forms a line match cannot see. Each one appends a step to the real kit uploader.
up_tree; printf '  - { command: .buildkite/scripts/evil.sh, agents: { queue: other } }\n' >> "$U/.buildkite/pipeline.yml"; up_run
expect_rc "upload: an added flow-style step is refused" 2
expect_out "upload: the refusal names the byte comparison" "not byte-for-byte the kit uploader"
up_tree; printf '  - "command": .buildkite/scripts/evil.sh\n' >> "$U/.buildkite/pipeline.yml"; up_run
expect_rc "upload: an added step with a quoted key is refused" 2
up_tree; printf '# one more line\n' >> "$U/.buildkite/pipeline.yml"; up_run
expect_rc "upload: any byte of difference is refused" 2
up_tree; rm "$U/.buildkite/pipeline.yml"; ln -s "$KIT/repo-kit/.buildkite/pipeline.yml" "$U/.buildkite/pipeline.yml"; up_run
expect_rc "upload: a symlinked pipeline.yml is refused" 2
up_tree; run "$U" -- bash .buildkite/scripts/upload.sh
expect_rc "upload: no kit checkout is refused" 2
up_tree; run "$U" WAVE_CI_DIR=relative/kit -- bash .buildkite/scripts/upload.sh
expect_rc "upload: a relative kit path is refused" 2
up_tree; run "$U" WAVE_CI_DIR="$KIT_NOFILE" -- bash .buildkite/scripts/upload.sh
expect_rc "upload: a kit checkout without the uploader is refused" 2

printf '\n%d passed, %d failed, %d skipped\n' "$pass" "$fail" "$skip"
[[ "$fail" -eq 0 ]]
