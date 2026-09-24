#!/usr/bin/env bash
# Local Android E2E: assumes `make dev-android` already installed the dev build on a
# running emulator and Metro is running (make dev). CI uses
# shared-workflows. `adb reverse` makes the host's Metro and mock API
# reachable from the emulator on the same ports.
set -euo pipefail
cd "$(dirname "$0")/../.."
# Assigns METRO_PORT, MOCK_API_PORT and the rest from APP_PORT_BASE
# (scripts/ports.mjs); an already-exported per-service variable wins.
eval "$(node scripts/ports.mjs --sh)"
bash scripts/e2e/wait-for-mock-api.sh
adb reverse "tcp:$METRO_PORT" "tcp:$METRO_PORT"
adb reverse "tcp:$MOCK_API_PORT" "tcp:$MOCK_API_PORT"
APP_ID="${APP_ID:-com.example.rnmt.dev}"
SCHEME="${SCHEME:-rnmt}"
# Foreground the app through the expo-development-client deep link, exactly as
# shared-workflows' scripts/e2e/app-launch.sh does (10.0.2.2 is the
# host's loopback as seen from the emulator). The dev client's launcher screen
# discovers Metro over Bonjour, which does not work on an emulator, so the deep
# link is the only reliable way in; 00-launch.yaml then attaches with
# `launchApp: stopApp: false`.
adb shell am start -a android.intent.action.VIEW \
  -d "$SCHEME://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A$METRO_PORT"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-120000}"
maestro test .maestro --config .maestro/config.yaml -e APP_ID="$APP_ID" \
  --debug-output .maestro/output --flatten-debug-output "$@"
