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
# No --error: a finding is reported, not thrown. --metrics off is telemetry
# only - it stops Semgrep phoning home with scan statistics, it does not make
# the run offline: --config p/... fetches each registry pack over the
# network on every invocation (see docs/security.md's known limitations).
semgrep scan \
  --config p/typescript --config p/secrets --config p/owasp-top-ten --config rules/ \
  --sarif --output "$out/code.sarif" --metrics off --quiet
echo "code: wrote $out/code.sarif"
