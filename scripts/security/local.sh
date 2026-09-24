#!/usr/bin/env bash
# Every enabled scanner, then the verdict - the same scripts and the same
# verdict CI runs, so a green laptop means a green pipeline. Locally a missing
# tool is a skip; under CI it is a failure.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/security/lib/common.sh
source scripts/security/lib/common.sh

if [ "$(node scripts/security/config.mjs get enabled)" != "true" ]; then
  echo "security scanning is disabled (SECURITY_ENABLED or security-policy.json)"
  exit 0
fi

out="$(sec_out_dir)"
rm -f "$out"/*.sarif
# Only the source-side jobs exist so far. The binary and LLM jobs join this
# list in their own stages; each is responsible for its own skip line.
for job in deps code policy; do
  bash "scripts/security/$job.sh"
done

node scripts/security/verdict.mjs "$out"
