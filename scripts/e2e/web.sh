#!/usr/bin/env bash
# `test:e2e:web`. Exports the web build, then runs the Playwright suite against
# it. When PLAYWRIGHT_SKIP_EXPORT is set the export is skipped and the suite
# runs against whatever is already in dist/ — react-native-workflows' web.yml
# sets it so Playwright tests the exact artifact the deploy job would publish
# instead of a second, possibly-different export.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ -n "${PLAYWRIGHT_SKIP_EXPORT:-}" ]; then
  echo "PLAYWRIGHT_SKIP_EXPORT set - testing the existing dist/ export"
else
  pnpm build:web --dev
fi

exec pnpm exec playwright test "$@"
