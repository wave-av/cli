#!/usr/bin/env bash
# guard-content-policy: the Buildkite twin of public-repo-guard.yml step "content
# policy". Runs the VENDORED scripts/public-repo-guard/content-policy.sh (never
# fetched from another repository at run time).
#
# No secret, on any build. This is a public repository, and the CI host gives a
# public repository no injected values by standing decision. So the private-repo
# rule (driven by the confidential GUARD_PRIVATE_REPOS list) does not apply to
# this pipeline's builds, by design: every build runs every other content-policy
# rule, and the log says the private-repo rule was not checked. If any of
# GUARD_PRIVATE_REPOS or GUARD_PRIVATE_REPOS_01.._06 is set, even empty, the
# wrapper exits 2: that list must never reach this pipeline, so its presence
# means the job environment was overridden or misconfigured. The names are not
# cleared and the run does not continue. (Local callers can still run the
# vendored scripts/public-repo-guard/content-policy.sh directly with a list.)
#
# Non-PR builds (step guard-content-policy) of the default branch run this
# checkout's policy. Any other Buildkite build whose checkout the author
# controls (a push to a non-default branch, which may be a same-repo PR's only
# build, or a PR number without the PR-mode flag) takes the same trusted runner
# as PR mode below: default-branch policy and .guardignore, and every in-tree
# escape (.guardignore, guard:allow, .ignore, .rgignore, .gitignore) ignored.
#
# PR mode: the non-secret WAVE_JOB_GUARD_PR=1 (set only by the pull-request step
# guard-content-policy-pr in pipeline.yml) selects the trusted runner below, and
# only when BUILDKITE_PULL_REQUEST is a positive integer (Buildkite's
# pull-request number). The same flag when BUILDKITE_PULL_REQUEST is empty,
# "false", or any other non-number fails closed (exit 2). Any other non-empty
# flag value (0, true, " 1", ...) fails closed too; empty counts as unset.
#
# Trusted policy in PR mode: the policy never runs from the pull-request
# checkout. This script fetches refs/heads/$BUILDKITE_PIPELINE_DEFAULT_BRANCH
# (never BUILDKITE_PULL_REQUEST_BASE_BRANCH, which the PR author picks) and
# runs that branch's scripts/public-repo-guard/content-policy.sh and
# .guardignore against a copy of the pull-request tree, which is data only.
# Inline `# guard:allow` markers are ignored in PR mode: they are
# pull-request content and must not exempt pull-request lines. The copy's
# .ignore, .rgignore and .gitignore files (any depth) are deleted too, so the
# default branch's .guardignore is the only exclusion source. When the
# default branch's copy of THIS wrapper carries the trusted-runner marker
# below, the PR copy re-execs that copy (`--trusted-stage`) and does nothing
# else itself. A missing default branch, fetch failure, or missing policy on
# the default branch exits 2; there is no fallback to the PR copy of the
# policy. Bootstrap: until the default branch's wrapper has the marker, the
# PR copy of this wrapper runs the steps above itself (still with the
# default-branch policy and .guardignore). The entry script of any
# Buildkite step is checkout code (no-command-eval), so a pull request that
# edits .buildkite/ can still change this wrapper or drop the step; closing
# that needs a host-side anchor (.buildkite/README.md, "Host-side setup").
#
# The GitHub workflow apt-installs ripgrep when missing; build guests must not
# assume sudo/apt, so a missing rg, or an rg without PCRE2 (the policy uses
# rg -P), fails closed with a clear message instead.
set -euo pipefail

# The default branch's copy of this file is re-executed in PR mode only
# when it carries this exact line (see header):
# guard-content-policy trusted-pr-runner: v1
_GUARD_TRUSTED_MARKER='# guard-content-policy trusted-pr-runner: v1'

# Stage 2 is the default-branch copy, exec'd from a temp dir with the
# pull-request checkout as the working directory, so it must not re-cd.
_guard_stage=1
if [ "${1:-}" = "--trusted-stage" ]; then
  _guard_stage=2
  shift
else
  cd "$(dirname "$0")/../.."
fi

_norm_repo() {
  # host/owner/name lowercase, no scheme/user/suffix (a raw comparison
  # false-refuses SSH-style pipeline URLs, but dropping the host would
  # collapse distinct SCM hosts into one identity). Anything without a
  # host/owner/name shape normalizes to EMPTY (not an identity): equally
  # malformed PR/pipeline values must refuse, never compare equal and bypass.
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E -e 's#^(https?|ssh|git)://([^/@]+@)?([^/]+)/#\3/#' -e 's#^git@([^:]+):#\1/#' -e 's#/$##' -e 's#\.git$##' | awk -F/ 'NF >= 3 && $1 != "" && $2 != "" && $3 != "" { print }'
}

# Buildkite sets BUILDKITE_PULL_REQUEST to the pull-request number, or to the
# string "false". Only a positive decimal integer selects PR mode.
# LC_ALL=C so [0-9] is ASCII: in a UTF-8 locale the bracket expression also
# matches other decimal digits, which must not select pull-request mode.
_guard_is_pr_number() {
  (
    LC_ALL=C
    [[ "${BUILDKITE_PULL_REQUEST:-}" =~ ^[1-9][0-9]*$ ]]
  )
}

# True on a Buildkite build whose checkout the author controls but which is not
# in PR mode: a pull-request number without WAVE_JOB_GUARD_PR=1, or any build
# whose branch is not the pipeline's default branch (a missing branch or
# default branch counts as untrusted). Same rule as guard-gitleaks.sh
# needs_trust. Such a build uses the default branch's policy and the same
# escape handling as PR mode (see _guard_run_trusted_pr). False outside Buildkite (local runs).
#
# A default-branch build counts as trusted only when BUILDKITE_TAG is empty AND
# HEAD is an ancestor of the freshly fetched default branch. Anyone who can
# start a build can pick its branch name and commit, so the name alone is not
# enough. A fetch failure counts as untrusted (the trusted runner then fails
# closed on the same fetch).
_guard_untrusted_branch_build() {
  [ -n "${BUILDKITE:-}" ] || return 1
  [ "${WAVE_JOB_GUARD_PR:-}" = "1" ] && return 1
  _guard_is_pr_number && return 0
  [ -n "${BUILDKITE_TAG:-}" ] && return 0
  [ -z "${BUILDKITE_BRANCH:-}" ] && return 0
  [ -z "${BUILDKITE_PIPELINE_DEFAULT_BRANCH:-}" ] && return 0
  [ "$BUILDKITE_BRANCH" != "$BUILDKITE_PIPELINE_DEFAULT_BRANCH" ] && return 0
  git check-ref-format --branch "$BUILDKITE_PIPELINE_DEFAULT_BRANCH" >/dev/null 2>&1 || return 0
  git -c core.hooksPath=/dev/null fetch --quiet --no-tags origin \
    "+refs/heads/$BUILDKITE_PIPELINE_DEFAULT_BRANCH:refs/guard-content-policy/trusted" >/dev/null 2>&1 || return 0
  if git merge-base --is-ancestor HEAD refs/guard-content-policy/trusted 2>/dev/null; then
    return 1
  fi
  return 0
}

# True when any private-repo list name is set, including empty. No build of
# this public repository's pipeline may carry these names. A set name is an
# overridden or misconfigured job environment; presence is enough, and the
# value is never printed.
_guard_private_list_present() {
  local _name
  for _name in \
    GUARD_PRIVATE_REPOS \
    GUARD_PRIVATE_REPOS_01 \
    GUARD_PRIVATE_REPOS_02 \
    GUARD_PRIVATE_REPOS_03 \
    GUARD_PRIVATE_REPOS_04 \
    GUARD_PRIVATE_REPOS_05 \
    GUARD_PRIVATE_REPOS_06
  do
    if [[ -v "$_name" ]]; then
      return 0
    fi
  done
  return 1
}

_guard_fail() {
  echo "guard-content-policy: $1 — failing closed."
  exit 2
}

# PR mode: fetch the default branch, then either re-exec its copy of this
# wrapper (stage 1, marker present) or scan a copy of the checkout with its
# policy and .guardignore. Always exits.
_guard_run_trusted_pr() {
  local default ref rc
  default="${BUILDKITE_PIPELINE_DEFAULT_BRANCH:-}"
  if [ -z "$default" ] || ! git check-ref-format --branch "$default" >/dev/null 2>&1; then
    _guard_fail "an untrusted build needs BUILDKITE_PIPELINE_DEFAULT_BRANCH (a valid branch name) to load the trusted policy"
  fi
  if [ "$_guard_stage" = "2" ]; then
    _guard_work="$(cd "$(dirname "$0")" && pwd)"
    case "$(basename "$_guard_work")" in
      guard-content-policy.*) ;;
      *) _guard_fail "--trusted-stage must run from its guard-content-policy.* temp dir" ;;
    esac
  else
    _guard_work="$(mktemp -d "${TMPDIR:-/tmp}/guard-content-policy.XXXXXXXX")"
  fi
  trap 'rm -rf "$_guard_work"' EXIT
  ref="refs/guard-content-policy/trusted"
  git -c core.hooksPath=/dev/null fetch --quiet --no-tags origin "+refs/heads/$default:$ref" \
    || _guard_fail "cannot fetch default branch '$default'"
  git cat-file -e "$ref:scripts/public-repo-guard/content-policy.sh" 2>/dev/null \
    || _guard_fail "default branch '$default' has no scripts/public-repo-guard/content-policy.sh (no fallback to the pull-request copy)"
  if [ "$_guard_stage" = "1" ] \
    && git show "$ref:.buildkite/scripts/guard-content-policy.sh" 2>/dev/null | grep -qxF "$_GUARD_TRUSTED_MARKER"; then
    git show "$ref:.buildkite/scripts/guard-content-policy.sh" > "$_guard_work/guard-content-policy.sh" \
      || _guard_fail "cannot extract the default-branch wrapper"
    trap - EXIT # stage 2 owns and removes the temp dir
    echo "guard-content-policy: running the '$default' copy of this wrapper (trusted stage)."
    exec bash "$_guard_work/guard-content-policy.sh" --trusted-stage
  fi
  if [ "$_guard_stage" = "1" ]; then
    echo "guard-content-policy: bootstrap — the '$default' copy of this wrapper has no trusted PR runner yet; this checkout's wrapper runs the '$default' policy and .guardignore."
  fi
  git show "$ref:scripts/public-repo-guard/content-policy.sh" > "$_guard_work/content-policy.sh" \
    || _guard_fail "cannot extract the default-branch policy"
  mkdir "$_guard_work/tree"
  tar -C . --exclude=./.git -cf - . | tar -C "$_guard_work/tree" -xf - \
    || _guard_fail "cannot copy the pull-request tree"
  # .guardignore comes from the default branch, never from the pull request.
  rm -rf "$_guard_work/tree/.guardignore"
  # rg's own ignore files are pull-request content too: a committed
  # .ignore, .rgignore or .gitignore at any depth must not exempt a file.
  # The default branch's .guardignore stays the only exclusion source.
  find "$_guard_work/tree" \( -name .ignore -o -name .rgignore -o -name .gitignore \) \
    \( -type f -o -type l \) -delete \
    || _guard_fail "cannot remove pull-request ignore files from the tree copy"
  if [ -n "$(find "$_guard_work/tree" \( -name .ignore -o -name .rgignore -o -name .gitignore \) -print -quit)" ]; then
    _guard_fail "a pull-request ignore file survived in the tree copy"
  fi
  # The policy filters allow markers out of the whole path:line:content record,
  # so a marker in a FILE OR DIRECTORY NAME would exempt every hit under it.
  # Content markers are neutralized below; a marker in a path cannot be, so any
  # such path fails closed.
  if [ -n "$(cd "$_guard_work/tree" && find . -path '*guard:allow*' -print -quit)" ]; then
    _guard_fail "a file or directory name in the tree contains 'guard:allow' (a marker in a path would exempt every hit under it)"
  fi
  if git cat-file -e "$ref:.guardignore" 2>/dev/null; then
    git show "$ref:.guardignore" > "$_guard_work/tree/.guardignore" \
      || _guard_fail "cannot extract the default-branch .guardignore"
  fi
  # Inline markers are pull-request content: neutralize every one in the copy.
  # -a so a NUL byte cannot hide a marker; no rg config may add flags.
  rc=0
  (cd "$_guard_work/tree" && env -u RIPGREP_CONFIG_PATH rg -l0 -a --hidden --no-ignore -F 'guard:allow' .) \
    > "$_guard_work/markers.lst" || rc=$?
  if [ "$rc" -ge 2 ]; then
    _guard_fail "ripgrep failed (exit $rc) listing guard:allow markers"
  fi
  local _f _n=0
  while IFS= read -r -d '' _f; do
    sed 's/guard:allow/guard-allow-ignored-in-pr-mode/g' "$_guard_work/tree/$_f" > "$_guard_work/marker.tmp" \
      || _guard_fail "cannot neutralize markers in $_f"
    cat "$_guard_work/marker.tmp" > "$_guard_work/tree/$_f"
    _n=$((_n + 1))
  done < "$_guard_work/markers.lst"
  echo "guard-content-policy: '# guard:allow' markers ignored on this untrusted build ($_n file(s)); policy and .guardignore from '$default'."
  rc=0
  (cd "$_guard_work/tree" && env -u RIPGREP_CONFIG_PATH bash "$_guard_work/content-policy.sh" .) || rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "guard-content-policy: content policy OK for the rules that ran ('$default' policy); private-repo rule NOT checked (public repository)"
  fi
  exit "$rc"
}

if [ -n "${BUILDKITE_PULL_REQUEST_REPO:-}" ]; then
  _head="$(_norm_repo "$BUILDKITE_PULL_REQUEST_REPO")"
  _pipe="$(_norm_repo "${BUILDKITE_REPO:-}")"
  if [ -z "$_head" ] || [ -z "$_pipe" ] || [ "$_head" != "$_pipe" ]; then
    # Log NORMALIZED forms: raw URLs can embed userinfo credentials.
    echo "fork PR detected (head ${_head:-<unparseable>} != pipeline ${_pipe:-<unparseable>}) — refusing."
    echo "Fork pull requests are not built on this pipeline; see .buildkite/README.md (Host-side setup)."
    exit 2
  fi
fi

# Reject a misconfigured environment before any scan. Every build still needs
# rg below, because every rule except private-repo must actually run.
# The list check comes first: any list name exits 2 on every build, PR or not.
# Clearing the names and continuing would hide the override.
case "${WAVE_JOB_GUARD_PR:-}" in
  "" | 1) ;;
  *)
    echo "WAVE_JOB_GUARD_PR must be unset, empty, or 1 — failing closed (any other value is a misconfigured job environment)."
    exit 2
    ;;
esac
if _guard_private_list_present; then
  echo "the private-repo list (GUARD_PRIVATE_REPOS or GUARD_PRIVATE_REPOS_01.._06) is set — failing closed (this public repository's pipeline never receives it; its presence means the job environment was overridden or misconfigured)."
  exit 2
fi
if [ "${WAVE_JOB_GUARD_PR:-}" = "1" ] && ! _guard_is_pr_number; then
  echo "WAVE_JOB_GUARD_PR=1 is set but BUILDKITE_PULL_REQUEST is not a pull-request number — failing closed."
  exit 2
fi

command -v rg >/dev/null 2>&1 || {
  echo "ripgrep (rg) is required but not installed in the agent image — failing closed."
  exit 2
}
# The policy runs `rg -P`, which errors on a ripgrep built without PCRE2.
# `rg --pcre2-version` exits non-zero on such a build, so require it here.
env -u RIPGREP_CONFIG_PATH rg --pcre2-version >/dev/null 2>&1 || {
  echo "ripgrep (rg) in the agent image has no PCRE2 support (rg --pcre2-version failed); the policy needs rg -P — failing closed."
  exit 2
}
_guard_trusted_runner=0
if [ "${WAVE_JOB_GUARD_PR:-}" = "1" ] || _guard_untrusted_branch_build; then
  _guard_trusted_runner=1
fi
if [ "$_guard_stage" = "2" ] && [ "$_guard_trusted_runner" != "1" ]; then
  echo "--trusted-stage is only valid on an untrusted build (PR mode, or a build that is not the default branch) — failing closed."
  exit 2
fi
echo "guard-content-policy: private-repo rule NOT checked (public repository, by design: no private list on any build); every other content-policy rule runs."
if [ "$_guard_trusted_runner" = "1" ]; then
  # The list names are absent; a present name already exited above.
  if [ "${WAVE_JOB_GUARD_PR:-}" = "1" ]; then
    export WAVE_JOB_GUARD_PR
  fi
  _guard_run_trusted_pr
fi
_rc=0
bash scripts/public-repo-guard/content-policy.sh . || _rc=$?
if [ "$_rc" -eq 0 ]; then
  echo "guard-content-policy: content policy OK for the rules that ran; private-repo rule NOT checked (public repository)"
fi
exit "$_rc"
