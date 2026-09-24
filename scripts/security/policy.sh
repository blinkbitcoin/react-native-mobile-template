#!/usr/bin/env bash
# The install-time supply-chain policy, asserted rather than assumed: a
# cooldown before any new release is installed, no implicit build scripts, and
# no silent downgrade of a package's trust. These are settings a hurried pull
# request can weaken in one line, which is exactly why they are scanned.
# Findings do not fail this script.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/security/lib/common.sh
source scripts/security/lib/common.sh

sec_enabled policy
out="$(sec_out_dir)"
file="${SECURITY_POLICY_FILE:-pnpm-workspace.yaml}"

check() {
  local id="$1" pattern="$2" message="$3"
  if grep -qE "$pattern" "$file" 2>/dev/null; then
    printf 'ok\t%s\t%s\t%s\n' "$id" "$file" "$message"
  else
    printf 'FAIL\t%s\t%s\t%s\n' "$id" "$file" "$message"
  fi
}

{
  check pnpm/minimum-release-age '^minimumReleaseAge: *[1-9][0-9]*[[:space:]]*(#.*)?$' \
    "minimumReleaseAge must stay set: it is what stops this repo being the first installer of a hijacked release"
  check pnpm/strict-dep-builds '^strictDepBuilds: *true[[:space:]]*(#.*)?$' \
    "strictDepBuilds must stay true: without it a transitive dependency runs its install scripts unreviewed"
  check pnpm/trust-policy '^trustPolicy: *no-downgrade[[:space:]]*(#.*)?$' \
    "trustPolicy must be no-downgrade: it refuses a package whose provenance got weaker than the version already installed"
} | node scripts/security/sarif.mjs lines policy > "$out/policy.sarif"

echo "policy: wrote $out/policy.sarif"
