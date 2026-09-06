#!/usr/bin/env bash
# Warns (exit 0) when architecture-relevant paths changed vs origin/main
# without a docs/ change; fails when AGENTS.md's command table lists a make
# target that does not exist.
set -euo pipefail
cd "$(dirname "$0")/.."
if git rev-parse --verify origin/main >/dev/null 2>&1; then
  changed="$(git diff --name-only origin/main...HEAD || true)"
  if echo "$changed" | grep -qE '^(app\.config\.ts|plugins/|modules/|src/graphql/|scripts/|Makefile)' && ! echo "$changed" | grep -q '^docs/'; then
    echo "warning: architecture-relevant changes without a docs/ update" >&2
  fi
fi
if [ -f AGENTS.md ]; then
  # shellcheck disable=SC2013,SC2016 # target names are single words with no embedded spaces/newlines to split incorrectly; backticked `make X` literals are intentionally single-quoted, not variable expansions.
  for t in $(grep -oE '`make [a-z-]+`' AGENTS.md | sed -E 's/`make ([a-z-]+)`/\1/' | sort -u); do
    grep -qE "^$t:" Makefile || { echo "AGENTS.md references missing make target: $t" >&2; exit 1; }
  done
fi
echo "docs check ok"
