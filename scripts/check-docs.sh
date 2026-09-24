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
# its diff must not turn into a failing build. It says so out loud (a
# ::notice:: under CI) rather than passing silently, so "no warning" is never
# confused with "nothing to warn about".
set -euo pipefail
cd "$(dirname "$0")/.."

# A skipped advisory says so. Silence reads as "nothing to warn about", which
# is exactly how this heuristic sat dead in CI for a whole release.
notice() {
  if [ -n "${CI:-}" ]; then echo "::notice::$1" >&2; else echo "notice: $1" >&2; fi
}

# CI checks out at depth 1, and two depth-1 tips share no ancestor: without a
# deepen the range below is unreadable and the freshness heuristic could never
# fire in the place it was written for. `--deepen` is an error on a complete
# clone, so fall back to a plain fetch; a repo with no remote at all falls
# through to the rev-parse guard.
deepen_origin() {
  git fetch -q --no-tags --deepen=50 origin "$@" >/dev/null 2>&1 ||
    git fetch -q --no-tags origin "$@" >/dev/null 2>&1 ||
    true
}

if [ "${EVENT_NAME:-}" = pull_request ] && [ -n "${BASE_REF:-}" ]; then
  # Explicit refspec: a CI checkout is single-branch, so its configured refspec
  # covers only the PR ref. `git fetch origin main` there lands in FETCH_HEAD
  # and never creates refs/remotes/origin/main, which is why naming the
  # destination is not optional.
  deepen_origin "+refs/heads/$BASE_REF:refs/remotes/origin/$BASE_REF"
  base="origin/$BASE_REF"
elif [ -n "${EVENT_NAME:-}" ]; then
  # A push: the previous tip is the base. origin/main is useless here - on a
  # push to main it *is* HEAD, so the range would always come back empty.
  deepen_origin
  base=HEAD~1
else
  base=origin/main
fi

if ! git rev-parse --verify "$base" >/dev/null 2>&1; then
  # A repo with no remote can never resolve origin/main, and saying so on every
  # local run trains people to ignore notices. Stay quiet until a remote exists.
  if [ -n "$(git remote 2>/dev/null)" ]; then
    notice "docs freshness skipped: cannot resolve $base (a shallow clone that does not reach it)"
  fi
else
  merge_base="$(git merge-base "$base" HEAD 2>/dev/null || true)"
  if [ -z "$merge_base" ]; then
    # 50 commits were not enough. One unshallow, then give up out loud.
    git fetch -q --no-tags --unshallow origin >/dev/null 2>&1 || true
    merge_base="$(git merge-base "$base" HEAD 2>/dev/null || true)"
  fi
  if [ -z "$merge_base" ]; then
    notice "docs freshness skipped: no merge base between $base and HEAD"
  else
    changed="$(git diff --name-only "$merge_base" HEAD 2>/dev/null || true)"
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
fi

if [ ! -f AGENTS.md ]; then
  echo "AGENTS.md is missing: the command table is the agent-facing contract" >&2
  exit 1
fi

# `name: [deps] ## description` — the same shape `make help` prints, except
# that this pattern also accepts digits in a target name (`gen-i18n`,
# `test-e2e-ios`).
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
