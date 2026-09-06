#!/usr/bin/env bash
# Every resolved package must come from the npm registry with an integrity hash.
# pnpm's v9 lockfile format encodes non-registry sources via `type: git`/`repo:`
# in the resolution map (git dependencies) or a `tarball:` URL (direct tarball
# deps) instead of a plain integrity hash; registry deps carry only `integrity:`.
set -euo pipefail
cd "$(dirname "$0")/.."
if grep -nE '^\s+resolution: \{.*\b(type: git|repo:|git\+|github:)' pnpm-lock.yaml; then
  echo "pnpm-lock.yaml contains git-hosted sources" >&2; exit 1
fi
if grep -nE '^\s+resolution: \{tarball: ' pnpm-lock.yaml | grep -v 'registry.npmjs.org'; then
  echo "pnpm-lock.yaml contains tarballs outside registry.npmjs.org" >&2; exit 1
fi
echo "lockfile ok"
