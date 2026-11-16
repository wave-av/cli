#!/usr/bin/env bash
# guard-gitleaks: the Buildkite twin of public-repo-guard.yml steps "Install gitleaks
# (pinned + checksum-verified)" and "gitleaks (secret scan — published tree)".
#
# Version pin and SHA-256 are copied from the GitHub workflow; bump the two together.
# One deliberate change: the workflow `sudo install`s to /usr/local/bin. Build guests must
# not assume sudo, so the verified binary runs from a temp dir instead. Same scan.
#
# Fork trust: on PR builds nothing executes from the PR checkout except as scan source.
# main() first re-execs the default-branch-tip copy of THIS script (a PR that rewrites
# the guard just re-installs the trusted copy), then scans a COPY of the PR tree with
# the default-branch .gitleaks.toml passed explicitly. The copy has every in-tree
# .gitleaksignore and .gitleaks.toml removed, the scan ignores gitleaks:allow, and its
# ignore path is an empty file (see scan_untrusted_copy). When the default branch has
# no config, the scan uses gitleaks' built-in default config (the copy has no config
# of its own and the config environment variables are unset), with a loud warning.
# The default branch is always fetched
# explicitly (never the PR's chosen base, never a possibly stale origin/<branch>). A
# default branch that cannot be fetched, a missing trusted script, or a missing or
# invalid default-branch name all fail closed (exit 2). The same trusted path covers
# push builds of any branch other than the default branch: that code is as
# author-controlled as a PR. Only a trusted Buildkite build of the default branch (no
# tag, and HEAD on the freshly fetched default branch; see needs_trust), or a local
# run outside Buildkite, scans directly with the worktree config.
# GITLEAKS_BIN, when set, skips the download. It is a local test seam only: under
# Buildkite (BUILDKITE set) it is refused, so job env cannot swap the scanner.
#
# Bootstrap: until this file is on the default branch, a PR build fails closed here
# ("default branch has no guard script"). That is intended: the guard never trusts PR content.
set -euo pipefail

GITLEAKS_VERSION="8.30.1"
GITLEAKS_SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
SCRIPT_REL_PATH=".buildkite/scripts/guard-gitleaks.sh"

is_pr_build() {
  [[ "${BUILDKITE_PULL_REQUEST:-false}" != "false" && -n "${BUILDKITE_PULL_REQUEST:-}" ]]
}

# needs_trust: true unless this is a local run (BUILDKITE unset) or a trusted
# Buildkite build of the default branch. Trusted means: not a PR, BUILDKITE_TAG
# empty, the branch equals the pipeline's default branch, AND HEAD is an
# ancestor of the freshly fetched default branch (anyone who can start a build
# can pick its branch name and commit, so the name alone is not enough). A
# missing branch or default branch, or a failed fetch, counts as untrusted, and
# the trusted path then fails closed. Computed once per process (_TRUST_STATE).
_TRUST_STATE=""
needs_trust() {
  if [[ -z "$_TRUST_STATE" ]]; then
    if compute_needs_trust; then _TRUST_STATE=untrusted; else _TRUST_STATE=trusted; fi
  fi
  [[ "$_TRUST_STATE" == untrusted ]]
}

compute_needs_trust() {
  if [[ -z "${BUILDKITE:-}" ]]; then
    is_pr_build
    return
  fi
  is_pr_build && return 0
  [[ -n "${BUILDKITE_TAG:-}" ]] && return 0
  [[ -z "${BUILDKITE_BRANCH:-}" || -z "${BUILDKITE_PIPELINE_DEFAULT_BRANCH:-}" ]] && return 0
  [[ "$BUILDKITE_BRANCH" != "$BUILDKITE_PIPELINE_DEFAULT_BRANCH" ]] && return 0
  local ref
  ref="$(base_ref 2>/dev/null)" || return 0
  if git merge-base --is-ancestor HEAD "$ref" 2>/dev/null; then
    return 1
  fi
  return 0
}

# base_ref: fetch the pipeline's DEFAULT branch explicitly and print the
# fetched ref. Never BUILDKITE_PULL_REQUEST_BASE_BRANCH: the PR author picks
# the base, so it could name a branch that carries a weakened guard or config
# (guard-content-policy.sh trusts the default branch the same way). Never an
# existing origin/<branch> either: Buildkite's checkout does not refresh it, so
# it may be stale or absent. The name is checked with a strict class plus
# `git check-ref-format` and passed as one argv element. A missing or invalid
# name, or a fetch failure, fails closed (exit 2).
base_ref() {
  local branch="${BUILDKITE_PIPELINE_DEFAULT_BRANCH:-}"
  if [[ -z "$branch" ]]; then
    echo "guard-gitleaks: untrusted build without BUILDKITE_PIPELINE_DEFAULT_BRANCH — failing closed" >&2
    return 2
  fi
  if [[ ! "$branch" =~ ^[A-Za-z0-9._/-]+$ ]] \
    || ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
    echo "guard-gitleaks: BUILDKITE_PIPELINE_DEFAULT_BRANCH is not a valid branch name — failing closed" >&2
    return 2
  fi
  local ref="refs/guard-gitleaks/trusted"
  git -c core.hooksPath=/dev/null fetch --quiet --no-tags origin -- "+refs/heads/${branch}:${ref}" >&2 \
    || { echo "guard-gitleaks: cannot fetch default branch '${branch}' — failing closed" >&2; return 2; }
  echo "$ref"
}

# trust_self: replace this PR-controlled script with the default-branch-tip
# copy and re-exec it. Caller must already be cd'd into the git repo. Never returns.
# The trusted handoff travels on ARGV (--trusted-work), never the
# environment: pipeline env is PR-influenced, so a GUARD_TRUSTED/GUARD_WORK
# pair from env would let a caller skip trust AND steer the cleanup trap.
trust_self() {
  local base
  base="$(base_ref)" || exit 2
  git rev-parse --verify --quiet "$base" >/dev/null 2>&1 \
    || { echo "guard-gitleaks: cannot resolve $base — failing closed" >&2; exit 2; }
  git cat-file -e "${base}:${SCRIPT_REL_PATH}" 2>/dev/null \
    || { echo "guard-gitleaks: default branch has no guard script — failing closed" >&2; exit 2; }
  git show "${base}:${SCRIPT_REL_PATH}" > "$WORK/trusted-guard-gitleaks.sh" \
    || { echo "guard-gitleaks: cannot extract trusted guard script — failing closed" >&2; exit 2; }
  # ${1+"$@"}: "$@" under set -u on old bash (macOS 3.2) errors with no args.
  exec bash "$WORK/trusted-guard-gitleaks.sh" --trusted-work "$WORK" ${1+"$@"}
}

# resolve_config: print the config path, or DEFAULTS for built-in rules.
# Uses $WORK (caller sets it). Never prints an author-controlled path on an
# untrusted build (see needs_trust).
resolve_config() {
  if ! needs_trust; then
    echo ".gitleaks.toml"
    return 0
  fi
  local base
  base="$(base_ref)" || return 2
  git rev-parse --verify --quiet "$base" >/dev/null 2>&1 \
    || { echo "guard-gitleaks: cannot resolve $base — failing closed" >&2; return 2; }
  if git cat-file -e "${base}:.gitleaks.toml" 2>/dev/null; then
    git show "${base}:.gitleaks.toml" > "$WORK/trusted.gitleaks.toml"
    echo "$WORK/trusted.gitleaks.toml"
  else
    echo "guard-gitleaks: WARNING no .gitleaks.toml on the default branch — scanning with gitleaks built-in default rules" >&2
    echo "DEFAULTS"
  fi
}

main() {
  # Trusted re-exec arrives as `--trusted-work DIR` on argv (see trust_self).
  # Anything else-shaped (including GUARD_* impostors in env, which are
  # ignored entirely) takes the normal path below.
  local trusted=0
  if [[ "${1:-}" == "--trusted-work" && -n "${2:-}" ]]; then
    # Re-exec'd: cwd is already the repo root (preserved across exec);
    # BASH_SOURCE now points into $WORK so it must NOT re-cd.
    WORK="$2"
    if [[ ! -d "$WORK" || ! -f "$WORK/trusted-guard-gitleaks.sh" ]]; then
      echo "guard-gitleaks: bad --trusted-work dir — failing closed" >&2
      exit 2
    fi
    trusted=1
    shift 2
  else
    if [[ "${1:-}" == "--trusted-work" ]]; then
      echo "guard-gitleaks: --trusted-work needs a directory — failing closed" >&2
      exit 2
    fi
    cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
    WORK="$(mktemp -d "${TMPDIR:-/tmp}/guard-gitleaks.XXXXXXXX")" || exit 2
  fi
  trap 'rm -rf "$WORK"' EXIT
  if [[ "$trusted" != "1" ]] && needs_trust; then
    trust_self ${1+"$@"}
  fi
  local bin
  if [[ -n "${GITLEAKS_BIN:-}" ]]; then
    if [[ -n "${BUILDKITE:-}" ]]; then
      echo "guard-gitleaks: GITLEAKS_BIN is a local test seam and is refused under Buildkite — failing closed" >&2
      exit 2
    fi
    bin="$GITLEAKS_BIN"
  else
    cd "$WORK"
    curl -fsSL --proto '=https' --tlsv1.2 -o gitleaks.tar.gz \
      "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
    echo "${GITLEAKS_SHA256}  gitleaks.tar.gz" | sha256sum -c -
    tar -xzf gitleaks.tar.gz gitleaks
    ./gitleaks version
    cd - >/dev/null
    bin="$WORK/gitleaks"
  fi
  local config
  config="$(resolve_config)" || exit 2
  if ! needs_trust; then
    if [[ "$config" == "DEFAULTS" ]]; then
      "$bin" detect --no-git --source . --redact --no-banner --exit-code 1
    else
      "$bin" detect --no-git --source . --config "$config" --redact --no-banner --exit-code 1
    fi
    return
  fi
  scan_untrusted_copy "$bin" "$config"
}

# scan_untrusted_copy BIN CONFIG: the trusted-path scan. gitleaks v8.30.1 reads
# three escape hatches from the scanned tree and its cwd: every .gitleaksignore
# at --gitleaks-ignore-path (default ".") and at the source root (cmd/root.go
# 300-321), any line containing gitleaks:allow (detect/detect.go 28, 510-513),
# and, with no --config, the source's own .gitleaks.toml (cmd/root.go 279-282,
# initConfig). All three are author content on this path. So: scan a copy of the
# checkout with every .gitleaksignore and .gitleaks.toml removed (any depth,
# files or links), from inside that copy (a cwd with no ignore file), pass the
# trusted config explicitly, ignore gitleaks:allow, and point the ignore path at
# an empty file. The config environment variables are unset for the run, so with
# no trusted config the scan uses gitleaks' built-in default config.
scan_untrusted_copy() {
  local bin="$1" config="$2" tree="$WORK/tree"
  mkdir "$tree" || { echo "guard-gitleaks: cannot create the scan copy — failing closed" >&2; exit 2; }
  tar -C . --exclude=./.git -cf - . | tar -C "$tree" -xf - \
    || { echo "guard-gitleaks: cannot copy the tree to scan — failing closed" >&2; exit 2; }
  find "$tree" \( -name .gitleaksignore -o -name .gitleaks.toml \) \( -type f -o -type l \) -delete \
    || { echo "guard-gitleaks: cannot remove in-tree gitleaks ignore/config files — failing closed" >&2; exit 2; }
  if [[ -n "$(find "$tree" \( -name .gitleaksignore -o -name .gitleaks.toml \) -print -quit)" ]]; then
    echo "guard-gitleaks: an in-tree .gitleaksignore or .gitleaks.toml survived in the scan copy — failing closed" >&2
    exit 2
  fi
  : > "$WORK/empty.gitleaksignore"
  local args=(detect --no-git --source . --ignore-gitleaks-allow
    --gitleaks-ignore-path "$WORK/empty.gitleaksignore" --redact --no-banner --exit-code 1)
  if [[ "$config" != "DEFAULTS" ]]; then
    args+=(--config "$config")
  fi
  echo "guard-gitleaks: scanning a copy of the tree with the default branch's config; in-tree .gitleaksignore, .gitleaks.toml and gitleaks:allow are ignored" >&2
  (cd "$tree" && env -u GITLEAKS_CONFIG -u GITLEAKS_CONFIG_TOML "$bin" "${args[@]}")
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main ${1+"$@"}
fi
