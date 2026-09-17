#!/usr/bin/env bash
# `test:e2e:web`. Exports the web build, then runs the Playwright suite against
# it. When PLAYWRIGHT_SKIP_EXPORT is set the export is skipped and the suite
# runs against whatever is already in dist/ — shared-workflows' web.yml
# sets it so Playwright tests the exact artifact the deploy job would publish
# instead of a second, possibly-different export.
set -euo pipefail
cd "$(dirname "$0")/../.."

# playwright.config.ts reads these rather than importing ports.mjs - Playwright
# require()s a .ts config, and requiring an ES module throws. Exporting here
# means the suite works however it is started: `make e2e-web` (which also
# evaluates this), `pnpm test:e2e:web`, or CI calling the script directly.
eval "$(node scripts/ports.mjs --sh)"

if [ -n "${PLAYWRIGHT_SKIP_EXPORT:-}" ]; then
  echo "PLAYWRIGHT_SKIP_EXPORT set - testing the existing dist/ export"
else
  pnpm build:web --dev
fi

exec pnpm exec playwright test "$@"
