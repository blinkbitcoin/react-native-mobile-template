#!/usr/bin/env bash
# Fails when message catalogs are stale relative to source (what CI runs).
set -euo pipefail
cd "$(dirname "$0")/.."
paths=(src/i18n/locales)

pnpm exec lingui extract --clean >/dev/null
pnpm exec lingui compile >/dev/null

# `git status --porcelain`, not `git diff`: a diff only sees files git already
# tracks, so a brand-new catalog for a locale nobody has committed yet is
# invisible to it and the gate passes on a tree that is genuinely stale. The
# reusable workflow's own fallback has always used this stronger form
# (scripts/lib/git-clean.sh, assert_clean_paths); this script is what CI runs
# now, so it has to be at least as strict as the thing it displaced.
dirty="$(git status --porcelain -- "${paths[@]}")"
if [ -n "$dirty" ]; then
  echo "i18n catalogs are out of date. Run: make gen-i18n" >&2
  printf '%s\n' "$dirty" >&2
  exit 1
fi
echo "i18n catalogs are current"
