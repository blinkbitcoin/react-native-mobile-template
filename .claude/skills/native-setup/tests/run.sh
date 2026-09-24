#!/bin/bash
# Offline tests for the native-setup skill: everything SKILL.md tells a reader
# to run or open must still exist, so the skill cannot quietly drift from the
# Makefile and the scripts it describes.
#
#   ./tests/run.sh

set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$TESTS_DIR/.." && pwd)"
ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
SKILL_MD="$SKILL_DIR/SKILL.md"
PASS=0
FAIL=0

ok() {
  PASS=$((PASS + 1))
  printf '  \033[32mPASS\033[0m %s\n' "$1"
}
bad() {
  FAIL=$((FAIL + 1))
  printf '  \033[31mFAIL\033[0m %s\n       %s\n' "$1" "$2"
}

echo "native-setup: make targets named in SKILL.md exist"
# `make setup-*` in prose is a wildcard, not a target: names end in a letter/digit.
targets="$(grep -oE 'make [a-z][a-z0-9-]*[a-z0-9]' "$SKILL_MD" | awk '{print $2}' | sort -u)"
[ -n "$targets" ] || bad "targets" "SKILL.md names no make targets"
for target in $targets; do
  if grep -qE "^${target}:" "$ROOT/Makefile"; then
    ok "make $target"
  else
    bad "make $target" "no such target in the Makefile"
  fi
done

echo "native-setup: repository paths named in SKILL.md exist"
# shellcheck disable=SC2016 # the backticks are literal: SKILL.md's code spans
paths="$(grep -oE '`(scripts|\.maestro|\.claude)/[^` ]+`' "$SKILL_MD" | tr -d '`' | sed 's/<[^>]*>.*//' | sort -u)"
for rel in $paths; do
  # Written by Maestro during a run, so absent from a clean checkout.
  case "$rel" in .maestro/output*) continue ;; esac
  if [ -e "$ROOT/$rel" ]; then
    ok "$rel"
  else
    bad "$rel" "path does not exist"
  fi
done

echo "native-setup: variables named in SKILL.md are defined in versions.env"
# shellcheck disable=SC2016 # literal backticks, as above
for var in $(grep -oE '`ANDROID_[A-Z_]+`' "$SKILL_MD" | tr -d '`' | sort -u); do
  [ "$var" = ANDROID_HOME ] && continue
  if grep -q "^${var}=" "$ROOT/scripts/setup/versions.env"; then
    ok "$var"
  else
    bad "$var" "not defined in scripts/setup/versions.env"
  fi
done

echo "native-setup: every symptom row has a cause and a fix"
rows="$(awk '/^## Symptom/{on=1} /^## Where/{on=0} on && /^\| [^-]/ && !/^\| Symptom/' "$SKILL_MD")"
count=0
while IFS= read -r row; do
  [ -n "$row" ] || continue
  count=$((count + 1))
  cells="$(printf '%s' "$row" | awk -F' \\| ' '{print NF}')"
  empty="$(printf '%s' "$row" | grep -cE '\|\s*\|' || true)"
  if [ "$cells" -ge 3 ] && [ "$empty" -eq 0 ]; then
    ok "row $count"
  else
    bad "row $count" "$row"
  fi
done <<<"$rows"
[ "$count" -ge 10 ] || bad "row count" "expected the pitfall tables, found $count rows"

echo "native-setup: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
