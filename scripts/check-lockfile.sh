#!/usr/bin/env bash
# Every resolved package must come from the npm registry with an integrity hash.
#
# An allowlist of shapes, not a list of bad ones. A registry package resolves
# to `{integrity: ...}`, or to `{integrity: ..., tarball: <registry.npmjs.org URL>}`
# when its tarball sits off the standard path; anything else is some other
# source. The earlier denylist (`type: git`, `repo:`, a *leading* `tarball:`)
# fell behind pnpm's own format: pnpm 12 writes a git dependency as
# `{gitHosted: true, integrity: ..., path: ..., tarball: https://codeload.github.com/...}`,
# which matched none of it and passed as "lockfile ok".
#
# One git source is allowed, exactly: shared-workflows' packages/dev-config at
# the one commit every shared-workflows call in .github/workflows pins
# (docs/decisions/0024-shared-tooling-at-the-workflows-pin.md). CI already runs
# that commit's code with this repository's token, so installing it adds no
# trust. Any other repository, path or commit still fails, and so does the
# package when the workflows pin no single commit.
#
# Usage: check-lockfile.sh [DIR]   (default: the repository root)
set -euo pipefail
cd "${1:-$(dirname "$0")/..}"
if [ ! -f pnpm-lock.yaml ]; then
  echo "no pnpm-lock.yaml in $(pwd)" >&2
  exit 1
fi
hash='[^,{}[:space:]]+'
allowed="resolution: \\{integrity: $hash(, tarball: https://registry\\.npmjs\\.org/$hash)?\\}\$"
pin="$({ grep -hoE 'blinkbitcoin/shared-workflows/\.github/workflows/[^@[:space:]]+@[0-9a-f]{40}' .github/workflows/*.yml 2>/dev/null || true; } | sed 's/.*@//' | sort -u)"
if [[ "$pin" =~ ^[0-9a-f]{40}$ ]]; then
  allowed="$allowed|resolution: \\{gitHosted: true, integrity: $hash, path: /packages/dev-config, tarball: https://codeload\\.github\\.com/blinkbitcoin/shared-workflows/tar\\.gz/$pin\\}\$"
fi
if other="$(grep -nE '^[[:space:]]+resolution:' pnpm-lock.yaml | grep -vE "$allowed")"; then
  echo "pnpm-lock.yaml resolves packages from outside the npm registry:" >&2
  printf '%s\n' "$other" >&2
  exit 1
fi
echo "lockfile ok"
