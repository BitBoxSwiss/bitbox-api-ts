#!/usr/bin/env bash

# SPDX-License-Identifier: Apache-2.0

# Runs the full validation pipeline. Called both by CI and by `make ci`
# so the two stay identical.

set -euo pipefail

cd "$(dirname "$0")"

if [ "${CI:-}" = "true" ]; then
    npm ci
fi

npm run proto:check
npm run typecheck
npm run lint
npm test
npm run build
npm run sandbox:typecheck
npm run sandbox:build

# Simulator smoke test. The suite itself self-skips on non-Linux/non-x64, but
# skipping here too avoids downloading binaries on unsupported runners.
if [ "$(uname -s)" = "Linux" ] && [ "$(uname -m)" = "x86_64" ] && [ "${SKIP_SIMULATOR:-}" != "1" ]; then
    npm run test:sim
fi
