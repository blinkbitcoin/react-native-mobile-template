#!/usr/bin/env bash
# Four checks, in this order:
#
#   1. Advisory (warn, exit 0): architecture-relevant paths changed vs the base
#      without a docs/ change. A package.json counts only when the change is
#      structural — scripts, engines, packageManager, expo.install.exclude —
#      and not a dependency or version bump (scripts/manifest-structural.mjs),
#      and a Dependabot PR is never expected to touch docs.
#   2. Strict (fail, exit 1): AGENTS.md's command table and the Makefile's
#      `##`-documented targets must agree in BOTH directions. The Makefile is
#      read at run time, so a target added by a later change fails this check
#      until AGENTS.md gains a row for it (and vice versa).
#   3. Strict (fail, exit 1): no markdown table cell line is wider than the
#      house limit (scripts/check-docs-tables.mjs).
#   4. Strict (fail, exit 1): every fenced ```mermaid block parses
#      (scripts/check-diagrams.mjs) — skips with a warning when the pinned CLI
#      cannot be fetched.
#
# Env (CI): EVENT_NAME, BASE_REF, PR_AUTHOR. Everywhere else the base is
# origin/main. Check 1 fails open at every step - an unfetchable base, an
# unreadable range, no remote at all - because a warning that cannot compute
# its diff must not turn into a failing build.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${EVENT_NAME:-}" = pull_request ] && [ -n "${BASE_REF:-}" ]; then
  # Quietly: a repo with no remote (or a shallow clone that cannot reach the
  # base) is handled by the rev-parse guard below, not by this fetch.
  git fetch -q --no-tags --depth=1 origin "$BASE_REF" >/dev/null 2>&1 || true
  base="origin/$BASE_REF"
else
  base=origin/main
fi

if git rev-parse --verify "$base" >/dev/null 2>&1; then
  # A fresh clone of a branch with no merge base against the base ref would
  # otherwise print git's "no merge base" error; the check is advisory anyway.
  changed="$(git diff --name-only "$base...HEAD" 2>/dev/null || true)"
  merge_base="$(git merge-base "$base" HEAD 2>/dev/null || echo "$base")"
  arch="$(echo "$changed" | grep -E '^(app\.config\.ts|plugins/|modules/|src/graphql/|scripts/|Makefile)' || true)"
  # A version or dependency bump moves no architecture, so the manifest only
  # joins the list when a non-dependency key actually changed.
  manifests="$(echo "$changed" | grep -E '(^|/)package\.json$' || true)"
  if [ -n "$manifests" ]; then
    # shellcheck disable=SC2086 # manifest paths are one per line and whitespace-free
    arch="$(printf '%s\n%s' "$arch" \
      "$(node scripts/manifest-structural.mjs "$merge_base" $manifests)" | sed '/^$/d')"
  fi
  if [ "${PR_AUTHOR:-}" = 'dependabot[bot]' ]; then
    : # a dependency update is never expected to touch docs/
  elif [ -n "$arch" ] && ! echo "$changed" | grep -q '^docs/'; then
    echo "warning: architecture-relevant changes without a docs/ update:" >&2
    while read -r path; do echo "  $path" >&2; done <<<"$arch"
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

node scripts/check-docs-tables.mjs
# --all in CI: the changed-file shortcut is a local convenience, and a CI run is
# the place where checking every diagram is worth the minute it costs.
if [ -n "${EVENT_NAME:-}" ]; then
  node scripts/check-diagrams.mjs --all
else
  node scripts/check-diagrams.mjs
fi

echo "docs check ok"
