#!/usr/bin/env bash
# Local Android E2E: assumes `make android` already installed the dev build on a
# running emulator and Metro is running (make start). CI uses
# react-native-workflows. `adb reverse` makes the host's Metro (8081) and mock
# API (4000) reachable from the emulator.
set -euo pipefail
cd "$(dirname "$0")/../.."
bash scripts/e2e/wait-for-mock-api.sh
adb reverse tcp:8081 tcp:8081
adb reverse tcp:4000 tcp:4000
APP_ID="${APP_ID:-com.example.rnmt.dev}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-120000}"
maestro test .maestro --config .maestro/config.yaml -e APP_ID="$APP_ID" \
  --debug-output .maestro/output --flatten-debug-output "$@"
