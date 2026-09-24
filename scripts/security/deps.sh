#!/usr/bin/env bash
# Known vulnerabilities, OpenSSF malicious-package records and licences for
# everything in pnpm-lock.yaml, from OSV. Reasoned ignores live in
# osv-scanner.toml, never in a threshold. Findings do not fail this script.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/security/lib/common.sh
source scripts/security/lib/common.sh

sec_enabled deps
sec_require osv-scanner deps

out="$(sec_out_dir)"
# --format sarif is osv-scanner's own SARIF; exit 1 means "findings", which is
# not a failure here. Anything above 1 is a real error and set -e catches it.
osv-scanner scan source --lockfile pnpm-lock.yaml --format sarif --output-file "$out/deps.sarif" || [ $? -eq 1 ]
echo "deps: wrote $out/deps.sarif"
