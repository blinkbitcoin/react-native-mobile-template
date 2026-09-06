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
SCHEME="${SCHEME:-rnmt}"
METRO_PORT="${METRO_PORT:-8081}"
# Foreground the app through the expo-development-client deep link, exactly as
# react-native-workflows' scripts/e2e/app-launch.sh does (10.0.2.2 is the
# host's loopback as seen from the emulator). The dev client's launcher screen
# discovers Metro over Bonjour, which does not work on an emulator, so the deep
# link is the only reliable way in; 00-launch.yaml then attaches with
# `launchApp: stopApp: false`.
adb shell am start -a android.intent.action.VIEW \
  -d "$SCHEME://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A$METRO_PORT"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-120000}"
maestro test .maestro --config .maestro/config.yaml -e APP_ID="$APP_ID" \
  --debug-output .maestro/output --flatten-debug-output "$@"
