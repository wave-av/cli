#!/usr/bin/env bash
# Pipeline upload. The pipeline's only settings step (held in Buildkite, not in this repo) runs
# `command: .buildkite/scripts/upload.sh`. The agents run with no-command-eval, so a step's command
# must be one script path inside the checkout (mode 100755, no arguments); a bare
# `buildkite-agent pipeline upload` command would be refused before it runs.
#   --no-interpolation       nothing from the job environment is substituted into the uploaded steps
#   --reject-parse-warnings  an unknown key or any other parse warning fails the upload
#
# The upload refuses (exit 2) a pipeline file that lacks either leak guard: the gitleaks step, or
# either content-policy step (guard-content-policy for builds that are not pull requests,
# guard-content-policy-pr for pull-request builds).
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pipeline="$root/.buildkite/pipeline.yml"
for step in guard-gitleaks guard-content-policy guard-content-policy-pr; do
  if ! grep -qE "^[[:space:]]+key:[[:space:]]+${step}[[:space:]]*$" "$pipeline"; then
    echo "upload: .buildkite/pipeline.yml has no '${step}' step; refusing to upload" >&2
    exit 2
  fi
done
exec buildkite-agent pipeline upload --no-interpolation --reject-parse-warnings "$pipeline"
