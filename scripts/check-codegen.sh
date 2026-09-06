#!/usr/bin/env bash
# Fails when src/graphql/generated is stale relative to schema/documents.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm codegen >/dev/null
if ! git diff --exit-code --quiet -- src/graphql/generated; then
  echo "GraphQL generated code is out of date. Run: make codegen" >&2
  git --no-pager diff --stat -- src/graphql/generated >&2
  exit 1
fi
echo "GraphQL generated code is current"
