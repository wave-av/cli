#!/usr/bin/env bash
# Step `license-truth`: license-truth.yml `local-truth` (offline: reads only files in the repo).
# The scheduled `registry-drift` job is not part of this pipeline (see the README).
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

cd "$BK_REPO_ROOT"
bk_assert_node_major 22
bk_npm_ci_public

bk_section "license truth gate"
npm run license:check
bk_section "license gate unit tests"
npx --no-install vitest run scripts/
