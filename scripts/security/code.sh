#!/usr/bin/env bash
# Semgrep CE over the app source: the community TypeScript, secrets and OWASP
# packs, plus this repo's React Native rules in rules/. No React Native ruleset
# exists upstream, which is why rules/ is ours. Findings do not fail this
# script. Paths to leave alone: .semgrepignore.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/security/lib/common.sh
source scripts/security/lib/common.sh

sec_enabled code
sec_require semgrep code

out="$(sec_out_dir)"
# No --error: a finding is reported, not thrown. --metrics off keeps the run
# offline and tells Semgrep not to phone home with scan statistics.
semgrep scan \
  --config p/typescript --config p/secrets --config p/owasp-top-ten --config rules/ \
  --sarif --output "$out/code.sarif" --metrics off --quiet
echo "code: wrote $out/code.sarif"
