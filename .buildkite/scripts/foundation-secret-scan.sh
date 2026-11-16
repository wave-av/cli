#!/usr/bin/env bash
# foundation-secret-scan: the Buildkite twin of .github/workflows/_checks.yml job `checks`, step
# "Secret scan (fail-closed, allowlist-aware)". The patterns are copied verbatim from the vendored
# _checks.yml; keep the two in sync on every bump of the shared foundation checks.
#
# Deliberate hardenings over the workflow step (same gate, safer plumbing):
#   * match CONTENT is never printed, only a generic failure message, so
#     credential values cannot enter Buildkite logs;
#   * the allowlist filter matches the full `pragma: allowlist secret` marker,
#     not the bare substring;
#   * pipeline exit statuses are captured: grep 0/1 continue, anything else
#     fails closed (no `|| true` masking scan errors as clean);
#   * the allowlist filter is an if/else, so a failing allowlist grep cannot
#     fall through to `cat` and hide its own error;
#   * both exemptions (the pragma marker and .github/.secret-allowlist) match the
#     matched line's CONTENT only: the scan reads file contents on standard input,
#     so no path:line: prefix is in the record. A marker or allowlist phrase in a
#     FILE OR DIRECTORY NAME can therefore never exempt a hit. The workflow filtered
#     the whole path:line:content record. Nothing is printed either way;
#   * binary files are scanned too. The workflow ran `grep -rI`, which skips any file
#     grep calls binary, and a file holding NUL bytes is binary: UTF-16 text, with or
#     without a byte-order mark, would hide a key. Here every file's NUL bytes are
#     removed before the match, so ASCII text stored as UTF-16 (or UTF-32) reads as
#     plain text and its keys are caught;
#   * blank and whitespace-only lines of .github/.secret-allowlist are dropped before
#     it is used. An empty fixed-string pattern matches every line, so one blank line
#     would otherwise exempt every hit. This guards against an accident, not an attacker:
#     both exemptions come from the tree under test, so a pull request controls them (a
#     one-character phrase still exempts most hits). The kit's gitleaks guard is the
#     control a pull request cannot edit;
#   * a carriage return ends a line, as a newline does. A file with CR-only line endings
#     would otherwise read as one line, and a pragma anywhere in it would exempt a key
#     anywhere else in it;
#   * only the top-level dist and node_modules folders are skipped. The workflow pruned
#     those names at any depth, so a committed src/dist/x.ts was never scanned.
set -euo pipefail
cd "$(dirname "$0")/../.."

PATTERN='(sk-[A-Za-z0-9]{20}|sk_(live|test)_[A-Za-z0-9]{20}|npm_[A-Za-z0-9]{30}|sbp_[a-f0-9]{40}|github_pat_[A-Za-z0-9_]{40}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30}|AIzaSy[A-Za-z0-9_-]{20}|xai-[A-Za-z0-9]{40}|xoxb-[A-Za-z0-9-]+|-----BEGIN [A-Z ]*PRIVATE KEY)'

SCAN_TMP="$(mktemp "${TMPDIR:-/tmp}/secret-scan.XXXXXXXX")"
ALLOW_TMP="$(mktemp "${TMPDIR:-/tmp}/secret-allow.XXXXXXXX")"
LIST_TMP="$(mktemp "${TMPDIR:-/tmp}/secret-files.XXXXXXXX")"
trap 'rm -f "$SCAN_TMP" "$ALLOW_TMP" "$LIST_TMP"' EXIT

fail_closed() {
  echo "secret-scan errored ($1) — failing closed"
  exit 2
}

# The allowlist without blank or whitespace-only lines (grep 1 = every line was blank). A carriage
# return ends a phrase, as it ends a scanned line below.
if [ -f .github/.secret-allowlist ]; then
  set +e
  LC_ALL=C tr '\r' '\n' <.github/.secret-allowlist | LC_ALL=C grep -av '^[[:space:]]*$' >"$ALLOW_TMP"
  ALLOW_STATUS=("${PIPESTATUS[@]}")
  set -e
  [ "${ALLOW_STATUS[0]}" -eq 0 ] || fail_closed "allowlist read status ${ALLOW_STATUS[*]}"
  [ "${ALLOW_STATUS[1]}" -le 1 ] || fail_closed "allowlist read status ${ALLOW_STATUS[*]}"
fi

# Every regular file outside .git, ./node_modules and ./dist (the workflow's exclusions, anchored to
# the top level; symlinks are not followed, as with grep -r). A find error fails closed.
find . \( -name .git -o -path ./node_modules -o -path ./dist \) -prune -o -type f -print0 >"$LIST_TMP" ||
  fail_closed "file listing failed"

# Each file's NUL bytes are removed, every carriage return becomes a newline, and a newline is added
# after the file, so no line runs across two files or past a CR.
emit_contents() {
  local f
  while IFS= read -r -d '' f; do
    LC_ALL=C tr -d '\000' <"$f" | LC_ALL=C tr '\r' '\n' || return 2
    printf '\n'
  done <"$LIST_TMP"
}

# Real-secret patterns. Lines tagged "pragma: allowlist secret" (e.g. test fixtures / regex
# definitions) are skipped; that is how a vetting module can define key shapes without tripping.
set +e
emit_contents \
  | LC_ALL=C grep -aE "$PATTERN" \
  | LC_ALL=C grep -av 'pragma: allowlist secret' \
  | { if [ -s "$ALLOW_TMP" ]; then LC_ALL=C grep -avFf "$ALLOW_TMP"; else cat; fi; } >"$SCAN_TMP"
SCAN_STATUS=("${PIPESTATUS[@]}")
set -e
[ "${SCAN_STATUS[0]}" -eq 0 ] || fail_closed "file read status ${SCAN_STATUS[*]}"
for s in "${SCAN_STATUS[@]:1}"; do
  [ "$s" -le 1 ] || fail_closed "pipeline status ${SCAN_STATUS[*]}"
done
if [ -s "$SCAN_TMP" ]; then echo "secret-like pattern found — do not commit credentials"; exit 1; fi
echo "secret-scan clean"
