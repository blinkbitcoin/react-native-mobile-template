#!/usr/bin/env bash
# The LLM security review of the change - review.mjs does the work and decides
# every skip; this only checks the switch and the tool. Off by default: it
# sends the diff to the configured provider. See docs/security.md.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/security/lib/common.sh
source scripts/security/lib/common.sh

sec_enabled review
sec_require git review

out="$(sec_out_dir)"
node scripts/security/review.mjs > "$out/review.sarif"
echo "review: wrote $out/review.sarif"
