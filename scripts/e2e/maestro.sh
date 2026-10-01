#!/usr/bin/env bash
# Local E2E: the Maestro flows against the dev build already on a booted iOS
# simulator or a running Android emulator (`make dev-ios` / `make dev-android`),
# with Metro (`make dev`) and the mock API (`make dev-api`) up.
# Usage: maestro.sh <ios|android> [maestro test arguments...]
#
# The launch and the suite are the shared tooling's, the scripts CI runs
# (node_modules/@blinkbitcoin/app-tooling/e2e/): the same deep link into the dev
# client, the same retry, the same check that flows ran. What is this app's
# stays here: the ports, which scripts/ports.mjs derives from APP_PORT_BASE, and
# the wait for the mock API before the suite starts.
set -euo pipefail
cd "$(dirname "$0")/../.."

platform="${1:-}"
case "$platform" in
  ios | android) shift ;;
  *)
    echo "usage: maestro.sh <ios|android> [maestro test arguments...]" >&2
    exit 2
    ;;
esac

# Assigns METRO_PORT, MOCK_API_PORT and the rest from APP_PORT_BASE; an
# already-exported per-service variable wins. Read on a line of its own, so a
# helper that rejects APP_PORT_BASE stops the script (`set -e` does not reach a
# failing `$(...)` inside eval's argument).
ports="$(node scripts/ports.mjs --sh)"
eval "$ports"
export WORKFLOWS_METRO_PORT="$METRO_PORT"
export WORKFLOWS_MOCK_API_PORT="$MOCK_API_PORT"
# Gitignored, and inside this checkout, so two worktrees never share a
# simulator choice or a junit report.
export WORKFLOWS_OUT="${WORKFLOWS_OUT:-$PWD/.maestro/output}"

# Before the launch, not as the suite's setup hook: the app asks the mock API
# for data as soon as it opens.
bash scripts/e2e/wait-for-mock-api.sh

e2e=node_modules/@blinkbitcoin/app-tooling/e2e
if [ "$platform" = ios ]; then
  bash "$e2e/ios-simulator.sh" pick
  bash "$e2e/app-launch.sh" ios
  exec bash "$e2e/ios-maestro.sh" "$@"
fi
exec bash "$e2e/android-maestro.sh" "$@"
