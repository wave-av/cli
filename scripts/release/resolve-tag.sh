#!/usr/bin/env bash
# scripts/release/resolve-tag.sh
#
# Resolves the release tag/version for BOTH release.yml triggers:
#   - push: tags: ['v*']     -> EVENT_NAME=push,             REF_NAME=<the tag>
#   - workflow_dispatch       -> EVENT_NAME=workflow_dispatch, DISPATCH_TAG=<input>
#         (used to backfill an existing tag, e.g. `-f tag=v1.0.9`)
#
# Prints two lines to stdout: `tag=<vX.Y.Z>` and `version=<X.Y.Z>`, in a form
# directly appendable to $GITHUB_OUTPUT. Fails loud (non-zero, no output) on
# anything that doesn't resolve to a `v*`-shaped tag — never guesses.
#
# Usage (CI):
#   EVENT_NAME="${{ github.event_name }}" \
#   REF_NAME="${{ github.ref_name }}" \
#   DISPATCH_TAG="${{ github.event.inputs.tag }}" \
#     scripts/release/resolve-tag.sh >> "$GITHUB_OUTPUT"
#
# Usage (local test):
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

case "$TAG" in
  v[0-9]*) ;;
  *)
    echo "::error::resolve-tag: '$TAG' does not match the required v* tag pattern" >&2
    exit 1
    ;;
esac

echo "tag=$TAG"
echo "version=${TAG#v}"
