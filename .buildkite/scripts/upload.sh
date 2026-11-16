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
# Sanity check, not a trust boundary (a pull request can edit this file): the upload refuses
# (exit 2) a pipeline file that has no step, or a step whose command is anything other than
# .buildkite/wave-ci.sh, or that uses `commands`, `plugins` or `trigger`.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pipeline="$root/.buildkite/pipeline.yml"
want='^[[:space:]]*(-[[:space:]]+)?command:[[:space:]]+\.buildkite/wave-ci\.sh[[:space:]]*$'
any='^[[:space:]]*(-[[:space:]]+)?(command|commands|plugins|trigger):'
[[ -f "$pipeline" ]] || { echo "upload: .buildkite/pipeline.yml is missing; refusing to upload" >&2; exit 2; }
if ! grep -qE "$any" "$pipeline"; then
  echo "upload: .buildkite/pipeline.yml has no step command; refusing to upload" >&2
  exit 2
fi
if grep -E "$any" "$pipeline" | grep -qvE "$want"; then
  echo "upload: .buildkite/pipeline.yml has a step that does not run .buildkite/wave-ci.sh; refusing to upload" >&2
  exit 2
fi
exec buildkite-agent pipeline upload --no-interpolation --reject-parse-warnings "$pipeline"
