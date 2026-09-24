#!/usr/bin/env bash
# Every enabled scanner, then the verdict - the same scripts and the same
# verdict CI runs, so a green laptop means a green pipeline. Locally a missing
# tool is a skip; under CI it is a failure.
#
#   bash scripts/security/local.sh              every job
#   bash scripts/security/local.sh bundle       one job, then its own verdict
#
# Each `make check-security-<job>` target is the second form, so a single
# scanner run on a laptop still ends in the same pass/fail answer CI gives.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/security/lib/common.sh
source scripts/security/lib/common.sh

# Captured into a variable rather than compared inline: `[ "$(cmd)" != x ]`
# discards cmd's own exit status, so a malformed security-policy.json or an
# invalid SECURITY_* value - both of which config.mjs is designed to throw
# on - would read as an empty string, never equal "true", and this would
# print "disabled" and exit 0 instead of failing the run.
if ! enabled="$(node scripts/security/config.mjs get enabled)"; then
  echo "config.mjs failed resolving enabled - security-policy.json or a SECURITY_* value is invalid (see the error above); that fails the run, it does not disable it" >&2
  exit 1
fi
if [ "$enabled" != "true" ]; then
  echo "security scanning is disabled (SECURITY_ENABLED or security-policy.json)"
  exit 0
fi

all_jobs=(deps code policy sbom bundle mobile binaries review openant)
if [ $# -eq 0 ]; then
  jobs=("${all_jobs[@]}")
else
  jobs=("$@")
  for job in "${jobs[@]}"; do
    case " ${all_jobs[*]} " in
      *" $job "*) ;;
      *)
        echo "unknown security job: $job (expected one of: ${all_jobs[*]})" >&2
        exit 2
        ;;
    esac
  done
fi

out="$(sec_out_dir)"
# Only this run's SARIF reaches the verdict: a stale file from an earlier run
# of another job would otherwise be judged as if it had just been produced.
rm -f "$out"/*.sarif
# A disabled job still runs its script: the script is what writes the skipped
# SARIF, so the verdict prints "skipped: disabled" rather than nothing at all.
for job in "${jobs[@]}"; do
  bash "scripts/security/$job.sh"
done

node scripts/security/verdict.mjs "$out"
