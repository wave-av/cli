#!/usr/bin/env bash
# scripts/release/resolve-tag.sh
#
# Resolves AND VALIDATES the release tag for BOTH release.yml triggers:
#   - push: tags: ['v*']     -> EVENT_NAME=push,             REF_NAME=<the tag>
#   - workflow_dispatch       -> EVENT_NAME=workflow_dispatch, DISPATCH_TAG=<input>
#         (used to backfill an existing tag, e.g. `-f tag=v1.0.9`)
#
# A workflow_dispatch `tag` input is attacker-influencable text, so it is
# validated in three stages before it is trusted for anything downstream:
#   1. Format   -- full-anchored regex, not a glob: exactly vX.Y.Z[-suffix].
#   2. Existence -- the tag must resolve to a real commit object in THIS repo
#      (git rev-parse), not just text that happens to look right.
#   3. Trust    -- that commit must be an ANCESTOR of origin/main (git
#      merge-base --is-ancestor), so every downstream job only ever
#      builds/publishes/releases code that was already merged and reviewed
#      on the default branch -- never a bespoke, unmerged payload smuggled in
#      via a crafted tag. Requires the caller's checkout to have fetched full
#      history + tags (fetch-depth: 0) -- a shallow clone cannot answer either
#      check.
#
# Prints three lines to stdout: `tag=<vX.Y.Z>`, `version=<X.Y.Z>`, and
# `sha=<40-char commit sha>`, in a form directly appendable to $GITHUB_OUTPUT.
# Downstream jobs MUST check out `sha`, never `tag` by name -- a git tag is a
# mutable pointer that can be repointed after this job validated it.
# Fails loud (non-zero, no output) on anything that doesn't resolve to a
# `v*`-shaped, existing, trusted tag — never guesses.
#
# Usage (CI):
#   EVENT_NAME="${{ github.event_name }}" \
#   REF_NAME="${{ github.ref_name }}" \
#   DISPATCH_TAG="${{ github.event.inputs.tag }}" \
#     scripts/release/resolve-tag.sh >> "$GITHUB_OUTPUT"
#
# Usage (local test, from a full clone):
#   EVENT_NAME=workflow_dispatch DISPATCH_TAG=v1.0.9 scripts/release/resolve-tag.sh

set -euo pipefail

EVENT_NAME="${EVENT_NAME:-}"
REF_NAME="${REF_NAME:-}"
DISPATCH_TAG="${DISPATCH_TAG:-}"

if [ "$EVENT_NAME" = "workflow_dispatch" ]; then
  TAG="$DISPATCH_TAG"
else
  TAG="$REF_NAME"
fi

if [ -z "$TAG" ]; then
  echo "::error::resolve-tag: no tag resolved (event=$EVENT_NAME ref_name=$REF_NAME dispatch_tag=$DISPATCH_TAG)" >&2
  exit 1
fi

# 1. Format -- full-anchored regex, not a glob.
if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "::error::resolve-tag: '$TAG' does not match the required vX.Y.Z[-suffix] pattern" >&2
  exit 1
fi

# 2. Existence -- the tag must resolve to a real commit object in THIS repo.
if ! SHA="$(git rev-parse --verify --quiet "refs/tags/${TAG}^{commit}")"; then
  echo "::error::resolve-tag: tag '$TAG' does not exist in this repository (or does not point at a commit)" >&2
  exit 1
fi

# 3. Trust -- the tag's commit must be an ancestor of origin/main.
if ! git merge-base --is-ancestor "$SHA" origin/main; then
  echo "::error::resolve-tag: tag '$TAG' (commit $SHA) is not reachable from origin/main -- refusing to build/publish/release an unmerged or unrecognized ref" >&2
  exit 1
fi

echo "resolve-tag: $TAG -> $SHA (verified: vX.Y.Z[-suffix] shape, exists, ancestor of origin/main)" >&2
echo "tag=$TAG"
echo "version=${TAG#v}"
echo "sha=$SHA"
