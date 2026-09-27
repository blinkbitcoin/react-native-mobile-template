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
# Usage: check-lockfile.sh [DIR]   (default: the repository root)
set -euo pipefail
cd "${1:-$(dirname "$0")/..}"
if [ ! -f pnpm-lock.yaml ]; then
  echo "no pnpm-lock.yaml in $(pwd)" >&2
  exit 1
fi
registry='resolution: \{integrity: [^,{}[:space:]]+(, tarball: https://registry\.npmjs\.org/[^,{}[:space:]]+)?\}$'
if other="$(grep -nE '^[[:space:]]+resolution:' pnpm-lock.yaml | grep -vE "$registry")"; then
  echo "pnpm-lock.yaml resolves packages from outside the npm registry:" >&2
  printf '%s\n' "$other" >&2
  exit 1
fi
echo "lockfile ok"
