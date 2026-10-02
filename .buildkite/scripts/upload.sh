#!/usr/bin/env bash
# Pipeline upload. The pipeline's only settings step (held in Buildkite, not in this repo) runs
# `command: .buildkite/scripts/upload.sh`. The agents run with no-command-eval, so a step's command
# must be one script path inside the checkout (mode 100755, no arguments); a bare
# `buildkite-agent pipeline upload` command would be refused before it runs.
#   --no-interpolation       nothing from the job environment is substituted into the uploaded steps
#   --reject-parse-warnings  an unknown key or any other parse warning fails the upload
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec buildkite-agent pipeline upload --no-interpolation --reject-parse-warnings "$root/.buildkite/pipeline.yml"
