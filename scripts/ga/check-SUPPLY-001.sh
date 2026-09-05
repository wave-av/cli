#!/usr/bin/env bash
# check-SUPPLY-001.sh — "release artifacts built by approved CI from an immutable source
# revision, provenance verifiable, SBOM attached, critical known vulnerabilities resolved or
# risk-accepted, publisher accounts require strong MFA."
#
# This script verifies ONLY the machine-checkable slice of that pass_condition: whether the
# artifact npm currently serves as `latest` carries a verifiable SLSA/npm provenance
# attestation. It does this in a throwaway directory with a FRESH npm user-config (no repo on
# any module path, no ambient auth, no scoped-registry override) — copied from the isolation
# approach in wave-av/sdks' registry clean-room, because a developer or runner whose ambient
# `@wave-av:registry` points at a private registry would otherwise silently test a DIFFERENT
# artifact than the one a real `npm install @wave-av/cli` resolves for a customer.
#
# WHAT THIS DOES NOT VERIFY (by design, and said so explicitly in the emitted evidence):
#   - SBOM attachment (SPDX/CycloneDX) — no SBOM-generating step exists in this repo's CI as of
#     writing; if one is added, extend `sbom-attached` below to check its output instead of
#     hardcoding UNKNOWN.
#   - critical known-vulnerability resolution / risk-acceptance.
#   - publisher-account MFA / branch-protection posture (an org-settings fact, not a repo fact).
# A `pass` result from this script therefore NEVER means "SUPPLY-001 fully satisfied" — see
# ga-evidence.mjs, which downgrades a clean provenance result to `unknown` for exactly this
# reason, per the WAVE GA gate's honesty rule that a status may never claim more than what was
# actually checked.
#
# OUTPUT: one line per check, exactly `PASS|FAIL|UNKNOWN <check-name>: <detail>` on stdout,
# plus `TARGET <id>` lines naming the concrete package/version this run observed.
#
# EXIT CODES
#   0  every printed check is PASS
#   1  at least one check is a real FAIL (provenance missing/invalid, or signatures invalid)
#   2  the check could not run at all (missing tool, unreachable registry, install failure)
#
# ENV (optional; used to prove the gate can fail — see the PR body's broken-input receipt)
#   GA_SUPPLY001_NPM_PACKAGE   override the npm package name queried (default: @wave-av/cli)
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || { echo "UNKNOWN setup: cannot cd to repo root $REPO_ROOT"; exit 2; }

NPM_REGISTRY="https://registry.npmjs.org"
FAIL_COUNT=0

emit() { printf '%s\n' "$1"; }
note_fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); }

command -v node >/dev/null 2>&1 || { emit "UNKNOWN setup: node not found on PATH"; exit 2; }
command -v npm  >/dev/null 2>&1 || { emit "UNKNOWN setup: npm not found on PATH"; exit 2; }
command -v curl >/dev/null 2>&1 || { emit "UNKNOWN setup: curl not found on PATH"; exit 2; }

DEFAULT_PACKAGE="@wave-av/cli"
if [ -f package.json ]; then
  DETECTED="$(node -e '
    const fs = require("fs");
    try { console.log(JSON.parse(fs.readFileSync("package.json", "utf8")).name || ""); }
    catch { console.log(""); }
  ')"
  [ -n "$DETECTED" ] && DEFAULT_PACKAGE="$DETECTED"
fi
NPM_PACKAGE="${GA_SUPPLY001_NPM_PACKAGE:-$DEFAULT_PACKAGE}"

# --- resolve the exact `latest` version + packument (public registry, unauthenticated) ------
ENC_PKG="$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$NPM_PACKAGE")"
LATEST_URL="${NPM_REGISTRY}/${ENC_PKG}/latest"
LATEST_BODY_FILE="$(mktemp)"
curl -fsS -o "$LATEST_BODY_FILE" "$LATEST_URL" 2>/dev/null
CURL_STATUS=$?
if [ "$CURL_STATUS" -ne 0 ]; then
  emit "UNKNOWN setup: could not reach public npm registry for ${NPM_PACKAGE} (${LATEST_URL}, curl exit ${CURL_STATUS})"
  rm -f "$LATEST_BODY_FILE"
  exit 2
fi

RESOLVED_VERSION="$(node -e '
  const fs = require("fs");
  try { console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version || ""); }
  catch { console.log(""); }
' "$LATEST_BODY_FILE")"
if [ -z "$RESOLVED_VERSION" ]; then
  emit "UNKNOWN setup: registry served no resolvable dist-tag latest for ${NPM_PACKAGE}"
  rm -f "$LATEST_BODY_FILE"
  exit 2
fi
emit "TARGET ${NPM_PACKAGE}@${RESOLVED_VERSION}"

# --- check 1: npm provenance attestation present on the packument --------------------------
PROVENANCE_DETAIL="$(node -e '
  const fs = require("fs");
  const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const att = d.dist && d.dist.attestations;
  if (att && att.provenance && att.provenance.predicateType) {
    console.log("PASS " + att.provenance.predicateType);
  } else {
    console.log("FAIL " + JSON.stringify(att === undefined ? null : att));
  }
' "$LATEST_BODY_FILE")"
rm -f "$LATEST_BODY_FILE"

if [[ "$PROVENANCE_DETAIL" == PASS* ]]; then
  emit "PASS npm-provenance-attested: ${NPM_PACKAGE}@${RESOLVED_VERSION} carries a provenance attestation (${PROVENANCE_DETAIL#PASS })"
else
  emit "FAIL npm-provenance-attested: ${NPM_PACKAGE}@${RESOLVED_VERSION} has NO provenance attestation on npm (dist.attestations=${PROVENANCE_DETAIL#FAIL }) — the published artifact cannot be traced to an approved CI build of an immutable source revision"
  note_fail
fi

# --- check 2: npm audit signatures — corroborating registry-signature validity --------------
# Fresh throwaway directory + fresh npm user-config: no repo on the module path, no ambient
# auth, no scoped-registry override. Lifecycle scripts are irrelevant here (no install target
# other than this one package matters) but are left at npm's default (this is a read-only
# signature/attestation check, not an execution of the installed code).
ROOM="$(mktemp -d)"
printf 'registry=%s/\n@wave-av:registry=%s/\naudit=false\nfund=false\nupdate-notifier=false\n' \
  "$NPM_REGISTRY" "$NPM_REGISTRY" > "${ROOM}/npm-userconfig"
: > "${ROOM}/npm-globalconfig"

(
  export npm_config_userconfig="${ROOM}/npm-userconfig"
  export npm_config_globalconfig="${ROOM}/npm-globalconfig"
  export npm_config_cache="${ROOM}/npm-cache"
  export npm_config_registry="${NPM_REGISTRY}/"
  cd "$ROOM" || exit 2
  npm init -y >/dev/null 2>&1
  npm install --no-audit --no-fund --loglevel=error "${NPM_PACKAGE}@${RESOLVED_VERSION}" >"${ROOM}/install.log" 2>&1
)
INSTALL_STATUS=$?
if [ "$INSTALL_STATUS" -ne 0 ]; then
  emit "UNKNOWN setup: clean-room \`npm install ${NPM_PACKAGE}@${RESOLVED_VERSION}\` failed (exit ${INSTALL_STATUS}): $(tail -c 500 "${ROOM}/install.log" 2>/dev/null | tr '\n' ' ')"
  rm -rf "$ROOM"
  exit 2
fi

AUDIT_JSON="$(
  export npm_config_userconfig="${ROOM}/npm-userconfig"
  export npm_config_globalconfig="${ROOM}/npm-globalconfig"
  export npm_config_cache="${ROOM}/npm-cache"
  export npm_config_registry="${NPM_REGISTRY}/"
  cd "$ROOM" && npm audit signatures --json 2>&1
)"
rm -rf "$ROOM"

AUDIT_VERDICT="$(node -e '
  try {
    const d = JSON.parse(process.argv[1]);
    const invalid = Array.isArray(d.invalid) ? d.invalid.length : 0;
    const missing = Array.isArray(d.missing) ? d.missing.length : 0;
    console.log((invalid === 0 && missing === 0 ? "PASS " : "FAIL ") + JSON.stringify({ invalid, missing }));
  } catch (e) {
    console.log("UNKNOWN " + String(e.message).slice(0, 200));
  }
' "$AUDIT_JSON" 2>&1)"

case "$AUDIT_VERDICT" in
  PASS*)
    emit "PASS npm-audit-signatures-clean: \`npm audit signatures\` reports zero invalid/missing registry signatures for the clean-room install of ${NPM_PACKAGE}@${RESOLVED_VERSION}"
    ;;
  FAIL*)
    emit "FAIL npm-audit-signatures-clean: \`npm audit signatures\` reports invalid/missing signatures (${AUDIT_VERDICT#FAIL }) for the clean-room install of ${NPM_PACKAGE}@${RESOLVED_VERSION}"
    note_fail
    ;;
  *)
    emit "UNKNOWN npm-audit-signatures-clean: could not parse \`npm audit signatures --json\` output (${AUDIT_VERDICT})"
    ;;
esac

# --- checks 3 & 4: clauses this script does NOT machine-verify ------------------------------
# Always reported explicitly, never silently omitted and never claimed as a pass.
# Excludes ga-evidence.yml itself: that workflow's own comments discuss the SBOM clause it does
# NOT verify, which would otherwise self-match and misreport this very workflow as a "candidate"
# SBOM generator.
SBOM_WORKFLOW_HIT="$(grep -ril -E 'sbom|cyclonedx|syft|spdx' "${REPO_ROOT}/.github" \
  --exclude='ga-evidence.yml' 2>/dev/null | head -1)"
if [ -n "$SBOM_WORKFLOW_HIT" ]; then
  emit "UNKNOWN sbom-attached: found a candidate SBOM-related workflow (${SBOM_WORKFLOW_HIT#"$REPO_ROOT"/}) but this script does not yet parse its output — extend check-SUPPLY-001.sh before trusting this clause"
else
  emit "UNKNOWN sbom-attached: no SBOM-generating workflow exists in this repository's .github/ — SBOM attachment is not verified by this producer"
fi
emit "UNKNOWN critical-vuln-resolution: this producer does not run a vulnerability scan or check risk-acceptance records — critical-vuln resolution is not verified"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
