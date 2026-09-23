#!/usr/bin/env bash
# Run the offline test suite of every skill under .claude/skills/.
#
# Called from `make check-release`, not on its own in `make check`: the store
# skills drive fastlane, and three of their cases diff the skill's lists against
# the fastlane gem under vendor/bundle. So they need what the release gate
# already needs (Ruby and a `bundle install`), and CI's Release job, which
# installs exactly that, is where they run.
set -euo pipefail
cd "$(dirname "$0")/.."
found=0
for t in .claude/skills/*/tests/run.sh; do
  [ -f "$t" ] || continue
  found=1
  echo "== $t"
  bash "$t"
done
[ "$found" -eq 1 ] || echo "no skills yet"
