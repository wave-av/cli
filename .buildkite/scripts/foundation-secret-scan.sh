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
#     fall through to `cat` and hide its own error.
set -euo pipefail
cd "$(dirname "$0")/../.."

# Real-secret patterns. Lines tagged "pragma: allowlist secret" (e.g. test fixtures / regex
# definitions) are skipped; that is how a vetting module can define key shapes without tripping.
SCAN_TMP="$(mktemp)"
trap 'rm -f "$SCAN_TMP"' EXIT
set +e
grep -rIEn '(sk-[A-Za-z0-9]{20}|sk_(live|test)_[A-Za-z0-9]{20}|npm_[A-Za-z0-9]{30}|sbp_[a-f0-9]{40}|github_pat_[A-Za-z0-9_]{40}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30}|AIzaSy[A-Za-z0-9_-]{20}|xai-[A-Za-z0-9]{40}|xoxb-[A-Za-z0-9-]+|-----BEGIN [A-Z ]*PRIVATE KEY)' \
  --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist . \
  | grep -v 'pragma: allowlist secret' \
  | { if [ -f .github/.secret-allowlist ]; then grep -vFf .github/.secret-allowlist; else cat; fi; } >"$SCAN_TMP"
SCAN_STATUS=("${PIPESTATUS[@]}")
set -e
for s in "${SCAN_STATUS[@]}"; do
  if [ "$s" -gt 1 ]; then
    echo "secret-scan errored (pipeline status ${SCAN_STATUS[*]}) — failing closed"
    exit 2
  fi
done
if [ -s "$SCAN_TMP" ]; then echo "secret-like pattern found — do not commit credentials"; exit 1; fi
echo "secret-scan clean"
