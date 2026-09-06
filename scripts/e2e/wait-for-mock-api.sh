#!/usr/bin/env bash
# Block until the local GraphQL mock API answers a `{ hello }` query.
set -euo pipefail
url="${1:-http://localhost:4000/graphql}"
for _ in $(seq 1 60); do
  if curl -fsS -H 'content-type: application/json' -d '{"query":"{ hello }"}' "$url" >/dev/null 2>&1; then exit 0; fi
  sleep 1
done
echo "mock API not reachable at $url (run: make mock-api)" >&2
exit 1
