#!/usr/bin/env bash
# Fails when src/graphql/generated is stale relative to schema/documents.
set -euo pipefail
cd "$(dirname "$0")/.."
paths=(src/graphql/generated)

pnpm codegen >/dev/null

# `git status --porcelain`, not `git diff`: a diff only sees tracked files, so a
# newly generated document for an operation nobody has committed yet is
# invisible to it and the gate passes on a stale tree. Matches the clean-tree
# assertion in the reusable workflow's fallback, which CI used to run instead.
dirty="$(git status --porcelain -- "${paths[@]}")"
if [ -n "$dirty" ]; then
  echo "GraphQL generated code is out of date. Run: make gen-graphql" >&2
  printf '%s\n' "$dirty" >&2
  exit 1
fi
echo "GraphQL generated code is current"
