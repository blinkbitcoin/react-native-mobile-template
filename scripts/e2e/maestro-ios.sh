#!/usr/bin/env bash
# Local iOS E2E: assumes `make ios` already installed the dev build on a booted
# simulator and Metro is running (make start). CI uses react-native-workflows.
set -euo pipefail
cd "$(dirname "$0")/../.."
bash scripts/e2e/wait-for-mock-api.sh
APP_ID="${APP_ID:-com.example.rnmt.dev}"
SCHEME="${SCHEME:-rnmt}"
METRO_PORT="${METRO_PORT:-8081}"
# Foreground the app through the expo-development-client deep link, exactly as
# react-native-workflows' scripts/e2e/app-launch.sh does. The dev client's own
# launcher screen discovers Metro over Bonjour, which does not work on a
# simulator, so the deep link is the only reliable way in; 00-launch.yaml then
# attaches with `launchApp: stopApp: false`.
xcrun simctl openurl booted \
  "$SCHEME://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$METRO_PORT"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-120000}"
maestro test .maestro --config .maestro/config.yaml -e APP_ID="$APP_ID" \
  --debug-output .maestro/output --flatten-debug-output "$@"
