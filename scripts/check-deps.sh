#!/usr/bin/env bash
# The Expo half of `make check-deps`: SDK drift is advisory, expo-doctor blocks.
#
# `expo install --check` and expo-doctor's version check both demand whatever
# patch the SDK expects *today*, and Expo publishes patches most weeks.
# `minimumReleaseAge` in pnpm-workspace.yaml refuses a patch until it is a day
# old, so for that day the two disagree and every open PR went red on a
# version this repo could not install yet. Failing unit and E2E - which the
# checks stage gates - over a same-day upstream patch told nobody anything.
#
# So the drift is reported, not enforced: the table is printed, CI gets a
# warning annotation, and the exit code is doctor's alone, with its version
# check switched off because this script has already run the same check.
# Doctor's other checks (config sync, package.json conflicts, duplicate
# native modules, ...) stay blocking - those are real breakage, not calendar.
set -euo pipefail
cd "$(dirname "$0")/.."

drift_output="$(pnpm exec expo install --check 2>&1)" && drift_status=0 || drift_status=$?
printf '%s\n' "$drift_output"
if [ "$drift_status" -ne 0 ]; then
  behind="$(printf '%s\n' "$drift_output" | grep -cE '^\s+\S+@\S+ - expected version:' || true)"
  msg="Expo SDK drift: ${behind} package(s) behind the SDK's expected patch. Advisory - run 'pnpm expo install --check' when minimumReleaseAge lets the patch in."
  echo "warning: $msg" >&2
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning title=Expo SDK drift::$msg"; fi
fi

# deps:doctor rather than the binary so knip sees the devDependency in use.
EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK=1 pnpm deps:doctor
