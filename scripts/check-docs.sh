#!/usr/bin/env bash
# Two checks, in this order:
#
#   1. Advisory (warn, exit 0): architecture-relevant paths changed vs
#      origin/main without a docs/ change.
#   2. Strict (fail, exit 1): AGENTS.md's command table and the Makefile's
#      `##`-documented targets must agree in BOTH directions. The Makefile is
#      read at run time, so a target added by a later change fails this check
#      until AGENTS.md gains a row for it (and vice versa).
set -euo pipefail
cd "$(dirname "$0")/.."

if git rev-parse --verify origin/main >/dev/null 2>&1; then
  # A fresh clone of a branch with no merge base against main would otherwise
  # print git's "no merge base" error; the check is advisory either way.
  changed="$(git diff --name-only origin/main...HEAD 2>/dev/null || true)"
  if echo "$changed" | grep -qE '^(app\.config\.ts|plugins/|modules/|src/graphql/|scripts/|Makefile)' && ! echo "$changed" | grep -q '^docs/'; then
    echo "warning: architecture-relevant changes without a docs/ update" >&2
  fi
fi

if [ ! -f AGENTS.md ]; then
  echo "AGENTS.md is missing: the command table is the agent-facing contract" >&2
  exit 1
fi

# `name: [deps] ## description` — the same shape `make help` prints, except
# that this pattern also accepts digits in a target name (`i18n`, `e2e-ios`).
documented="$(grep -oE '^[a-zA-Z0-9_-]+:[^#]*## ' Makefile | cut -d: -f1 | sort -u)"
# Every command-table row is a `make <target>` literal, so one grep covers the
# whole table (and any `make x` named in AGENTS.md prose).
# shellcheck disable=SC2016 # the backticked `make x` literals are markdown, not command substitution.
listed="$(grep -oE '`make [a-z0-9-]+`' AGENTS.md | sed -E 's/`make ([a-z0-9-]+)`/\1/' | sort -u)"

fail=0

while read -r target; do
  [ -n "$target" ] || continue
  if ! printf '%s\n' "$listed" | grep -qxF "$target"; then
    echo "AGENTS.md is missing a command-table row for make target: $target" >&2
    fail=1
  fi
done <<<"$documented"

while read -r target; do
  [ -n "$target" ] || continue
  if ! grep -qE "^$target:" Makefile; then
    echo "AGENTS.md references missing make target: $target" >&2
    fail=1
  fi
done <<<"$listed"

if [ "$fail" -ne 0 ]; then
  echo "AGENTS.md and the Makefile disagree; update whichever is wrong" >&2
  exit 1
fi

echo "docs check ok"
