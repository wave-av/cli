#!/usr/bin/env bash
# Bridge for the pipeline's Steps setting. That setting is held in Buildkite, outside this
# repository, and still runs `command: .buildkite/scripts/upload.sh`. This script uploads
# .buildkite/pipeline.yml, the shared kit's thin uploader, unchanged. The uploader's one running
# step then renders the full pipeline (the two leak guards first, then this repository's steps
# from .buildkite/wave-ci.json) and uploads it.
#
# Once the Steps setting holds the same YAML as .buildkite/pipeline.yml, nothing calls this file
# and it can be deleted in a follow-up change. Delete it only after that swap: until then, every
# build starts here.
#
# The agents run with no-command-eval, so a step's command must be one script path inside the
# checkout (mode 100755, no arguments); a bare `buildkite-agent pipeline upload` command would be
# refused before it runs.
#   --no-interpolation       nothing from the job environment is substituted into the uploaded steps
#   --reject-parse-warnings  an unknown key or any other parse warning fails the upload
#
# What it uploads: only a pipeline.yml that is byte-for-byte the kit's own uploader,
# repo-kit/.buildkite/pipeline.yml, in the kit checkout the build host prepared for the pinned
# commit (WAVE_CI_DIR, exported by the host's post-checkout hook and verified again by the shim in
# the next job). Comparing bytes, not matching lines, means no YAML form (flow style, quoted keys,
# anchors) can add a step. Anything else exits 2: no WAVE_CI_DIR, no kit uploader there, a missing
# pipeline.yml, or any difference.
#
# Sanity check, not a trust boundary: a pull request can edit this file and pipeline.yml together.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pipeline="$root/.buildkite/pipeline.yml"
refuse() { echo "upload: $1; refusing to upload" >&2; exit 2; }

[[ -f "$pipeline" && ! -L "$pipeline" ]] || refuse ".buildkite/pipeline.yml is missing or not a regular file"
kit_dir="${WAVE_CI_DIR:-}"
[[ "$kit_dir" == /* ]] || refuse "WAVE_CI_DIR is not set to the kit checkout (it is set by the build host)"
kit="$kit_dir/repo-kit/.buildkite/pipeline.yml"
[[ -f "$kit" && ! -L "$kit" ]] || refuse "the kit checkout has no repo-kit/.buildkite/pipeline.yml"
# git is a build-image prerequisite; --no-filters hashes the raw bytes of each file.
want="$(git hash-object --no-filters -- "$kit")" || refuse "cannot hash the kit uploader"
have="$(git hash-object --no-filters -- "$pipeline")" || refuse "cannot hash .buildkite/pipeline.yml"
[[ -n "$want" && "$want" == "$have" ]] || refuse ".buildkite/pipeline.yml is not byte-for-byte the kit uploader at the pinned commit"
exec buildkite-agent pipeline upload --no-interpolation --reject-parse-warnings "$pipeline"
