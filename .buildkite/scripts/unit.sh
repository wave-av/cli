#!/usr/bin/env bash
# Step `unit`: smoke-install.yml `unit`. Type-check, build and the unit tests (including the version
# regression tests), on Node 22. No credential.
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

cd "$BK_REPO_ROOT"
bk_assert_node_major 22
bk_npm_ci_public

bk_section "type-check"
npm run type-check
bk_section "build"
npm run build
bk_section "unit tests"
npm test
