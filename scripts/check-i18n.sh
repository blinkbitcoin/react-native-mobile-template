#!/usr/bin/env bash
# Fails when message catalogs are stale relative to source (what CI runs).
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm exec lingui extract --clean >/dev/null
pnpm exec lingui compile >/dev/null
if ! git diff --exit-code --quiet -- src/i18n/locales; then
  echo "i18n catalogs are out of date. Run: make i18n" >&2
  git --no-pager diff --stat -- src/i18n/locales >&2
  exit 1
fi
echo "i18n catalogs are current"
