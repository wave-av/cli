#!/usr/bin/env bash
# Fixture tests for body-policy.sh.
#
# Deliberately fixture-only: the gate is NEVER proved by writing a real leak into a
# live public PR body, because doing so would publish the exact thing it guards.
#
# The negatives here are the load-bearing half. A leak gate that blocks everything
# is trivially "correct" and useless — it gets disabled within a week. The bare
# cross-reference case below is the one that keeps this gate deployable.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/body-policy.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The names the real gate is configured with come from an org variable; the tests
# pin their own so they are hermetic and do not depend on CI configuration.
export GUARD_PRIVATE_REPOS="wave-gateway, wave-transports, agent-money"

PASS=0; FAIL=0

# expect <exit-code> <name> <body-text>
expect() {
  local want="$1" name="$2" body="$3" out rc
  printf '%s\n' "$body" > "$TMP/body.txt"
  out="$(bash "$SCRIPT" "$TMP/body.txt" 2>&1)"; rc=$?
  if [[ "$rc" == "$want" ]]; then
    PASS=$((PASS+1)); printf '  ok   %s\n' "$name"
  else
    FAIL=$((FAIL+1)); printf '  FAIL %s — want exit %s, got %s\n%s\n' "$name" "$want" "$rc" "$out"
  fi
  # The annotation is world-readable; a hit must never echo the matched text.
  if [[ "$rc" == 1 ]] && printf '%s' "$out" | grep -qF "$body"; then
    FAIL=$((FAIL+1)); printf '  FAIL %s — LEAKED the matched text into the annotation\n' "$name"
  fi
}

echo "body-policy fixtures"

# --- must BLOCK ---------------------------------------------------------------
expect 1 'private repo + credential name' \
  'Flip is live: WAVE_VIEWPORT_LEASE_SECRET is bound on wave-gateway now.'
expect 1 'private repo + credential name, reverse order' \
  'The MOQ_JOIN_SECRET was added; wave-transports picks it up on deploy.'
expect 1 'private repo + secret count' \
  'wave-gateway went from 74 secrets to 75 after this change.'
expect 1 'private repo + service binding' \
  'This adds a service binding from the worker to agent-money for settlement.'
expect 1 'operator home path' \
  'Repro: run it from /Users/someoperator/Documents/notes and it fails.'  # enforce-ignore (fixture)
expect 1 'internal-only marker' \
  'Attaching the internal-only rollout plan for context.'
# Assembled at run time rather than written as a literal: a fixture that LOOKS like
# a live AWS key trips this repo's own pre-commit secret scanners (it did, on the
# first draft). Splitting the prefix keeps the fixture exercising the real regex
# without parking a credential-shaped string in source.
AKID_FIXTURE="AKI""A1234567890ABCDEF"
expect 1 'AWS access key id' \
  "The failing job had ${AKID_FIXTURE} configured."
# Regression: the about-the-control allowlist once applied to EVERY rule, so a key
# pasted in a sentence that happened to name the gate was reported clean. Credential
# formats are never legitimate in prose — no gate word may exempt one.
expect 1 'gate word on the same line does NOT exempt a credential' \
  "body-policy note: the leaked key was ${AKID_FIXTURE} here."
# Regression: `guard:allow` once exempted EVERY rule, but a body has no reviewable
# diff — the untrusted author can append the marker in the same edit that leaks.
# The marker may only exempt the self-referential prose rules, never a credential.
expect 1 'guard:allow does NOT exempt a credential in a body' \
  "Key for the repro: ${AKID_FIXTURE} — guard:allow repro-example"
expect 1 'internal tailscale IP' \
  'It resolves to 100.71.4.19 from inside the fleet.'
# The range-designation exemption must stay razor-thin: a host one address past
# the all-zero network form is a real fleet machine and still blocks.
expect 1 'host adjacent to the network address still blocks' \
  'The subnet router answers on 100.64.0.1 inside the fleet.'
# Regression: `read` stops at the first newline, so a newline-separated org variable
# once configured only the first name and passed over the unscanned rest.
GUARD_PRIVATE_REPOS=$'wave-gateway\nwave-transports\nagent-money' \
expect 1 'newline-separated GUARD_PRIVATE_REPOS still scans later names' \
  'The MOQ_JOIN_SECRET was added; wave-transports picks it up on deploy.'
# Regression: a CRLF-stored variable once glued an invisible \r to every name, so
# the built regex matched nothing and the gate fail-opened with no diagnostic.
GUARD_PRIVATE_REPOS=$'wave-gateway\r\nwave-transports\r\nagent-money\r' \
expect 1 'CRLF-separated GUARD_PRIVATE_REPOS still scans every name' \
  'The MOQ_JOIN_SECRET was added; wave-transports picks it up on deploy.'

# --- must BLOCK: the TITLE / COMMIT-MESSAGE class -----------------------------
# The shape that actually leaked on 2026-09-10: an internal tracking id inside a
# conventional-commit scope, in a PR TITLE and in the commit messages under it.
# Nothing read either surface, because the only gate in front of them scanned FILE
# CONTENT. This is the regression case for that whole class.
expect 1 'internal id in a conventional-commit scope (the real title-leak shape)' \
  'fix(REL-003): the canary marker never matched'
expect 1 'the same id in a commit message body' \
  'Marker now matches on the whole line. Closes SUPPLY-001.'
expect 1 'internal decision-record id' \
  'Deployed under IGV-D-005 after the soak.'
expect 1 'internal plan / workstream id' \
  'Tracked in E4-GAM-PUBLIC, row 9 of the target table.'
expect 1 'internal process document path' \
  'Per governance/plans/public-supply-chain/E4.md the guard is vendored.'
expect 1 'wikilink to an internal rule' \
  'This follows [[proven-live-or-not-done]] so the receipt is attached.'
expect 1 'long-hyphenated internal rule filename' \
  'Stated in rules/public-repo-rules-for-build-agents.md, rule 2.'

# --- must PASS (precision — these keep the gate deployable) -------------------
# The standards / algorithm / branch silhouettes. Every one of these shares the
# XX-### outline with an internal id and appears constantly in legitimate public
# release notes; a gate that blocks them is a gate that gets switched off in a day.
expect 0 'checksum algorithm name (SHA-256) is not an internal id' \
  'Verify the SHA-256 of the release asset against the checksums file.'
expect 0 'standards names (PEP-503, ISO-8601, CWE-200) are not internal ids' \
  'PEP-503 normalizes names; timestamps are ISO-8601; see CWE-200 for the class.'
expect 0 'a CVE id has four digits and is ordinary open-source content' \
  'Bump the transport dep to 0.28.1 for CVE-2025-12345; no API change.'
expect 0 'lowercase branch and runbook words keep the shape but are not ids' \
  'Opened from fix/issue-123 against main; step-001 of the runbook.'
expect 0 'an eslint-style rules/ doc path is not an internal document path' \
  'Documented in rules/no-unused-vars.md; see docs/rules.md.'
expect 0 'a bare governance word is not an internal path' \
  'The release notes now describe the governance of the signing key.'
expect 0 'an ordinary conventional-commit scope is untouched' \
  'fix(release): generate the SBOM after install, not before'
expect 0 'talking about the id rule is prose about the control' \
  'body-policy now blocks an internal id like REL-003 in a title.'
expect 0 'bare private-repo cross-reference' \
  'This is the companion change to wave-transports#260; merge that one first.'
expect 0 'two private repos, no operational detail' \
  'Both wave-gateway and wave-transports will need a follow-up for this.'
expect 0 'credential NAME with no private repo nearby' \
  'The handler now reads SOME_API_TOKEN from the environment instead of a literal.'
# Regression: a global (?i) once leaked into the SCREAMING_CASE alternative, so
# ordinary lowercase prose like "api_key" counted as a credential NAME.
expect 0 'lowercase api_key near a private repo is prose, not a credential NAME' \
  'Update wave-gateway docs to read the api_key from config.'
expect 0 'public runner path is not an operator path' \
  'CI checks out to /home/runner/work/repo/repo before the scan runs.'  # enforce-ignore (fixture)
expect 0 'talking about the control' \
  'body-policy blocks a private repo named next to a SECRET_TOKEN; that is intended.'
expect 0 'explicit guard:allow with a reason' \
  'Example for the docs: wave-gateway holds EXAMPLE_SECRET — guard:allow documented-example'
expect 0 'ordinary clean body' \
  'Bumps the draft revision and regenerates the fixtures. No behaviour change.'
# Regression risk called out in review: the gate's own docs (and any body quoting
# them, which review bots do) name the range as 100.64.0.0/10. That is the NAME
# of the range, not a host on it, and infra rules have no allowlist escape.
expect 0 'the CGNAT range designation is the name of the range, not a host' \
  'The internal-ip rule covers the 100.64.0.0/10 space by design.'
expect 0 'the bare all-zero network address is a designation too' \
  'Traffic in 100.64.0.0 space never leaves the tailnet.'
# Regression: the first CI run of this job failed on its own PR, because a review
# bot edited the body to summarize the change and quoted the marker verbatim.
expect 0 'marker MENTIONED in straight quotes is a description' \
  'Blocks infra identifiers and markers (account_id, home paths, "internal-only" text).'
expect 0 'marker MENTIONED in a code span' \
  'The rule matches `internal-only` and `for internal use` in body text.'
expect 0 'marker MENTIONED in smart quotes' \
  'Blocks operator home paths and “internal-only” text.'
expect 1 'marker USED unquoted still blocks' \
  'Attaching the internal-only rollout plan; do not share outside the team.'

# --- fail closed --------------------------------------------------------------
# Invoked directly, not through expect(): expect() always materializes a file, so
# it cannot reach these paths. A gate that returns "OK" when it was handed nothing
# to scan is the failure mode this whole file exists to prevent.
for case in "no argument at all::" "nonexistent path::$TMP/does-not-exist.txt"; do
  name="${case%%::*}"; arg="${case##*::}"
  if [[ -n "$arg" ]]; then bash "$SCRIPT" "$arg" >/dev/null 2>&1; else bash "$SCRIPT" >/dev/null 2>&1; fi
  rc=$?
  if [[ "$rc" == 2 ]]; then
    PASS=$((PASS+1)); printf '  ok   %s → exit 2 (fails closed)\n' "$name"
  else
    FAIL=$((FAIL+1)); printf '  FAIL %s — want exit 2, got %s\n' "$name" "$rc"
  fi
done

echo "  ---"
if (( FAIL > 0 )); then
  echo "  $PASS passed, $FAIL FAILED"; exit 1
fi
echo "  $PASS passed, 0 failed"
