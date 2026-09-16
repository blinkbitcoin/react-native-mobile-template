#!/usr/bin/env bash
# E2E setup hook (react-native-workflows `e2e-setup-script`): start the local
# GraphQL mock API in the background and wait until it answers.
# Run from the consumer root by $WORKFLOWS_DIR/scripts/e2e/run-hook.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."

out="${WORKFLOWS_OUT:-/tmp}"
mkdir -p "$out"
log="$out/mock-api.log"
pidfile="$out/mock-api.pid"

# Assigns MOCK_API_PORT and the rest from APP_PORT_BASE (scripts/ports.mjs).
# That is the port the bundle calls: .env.development bakes it into
# EXPO_PUBLIC_API_URL.
eval "$(node scripts/ports.mjs --sh)"

nohup pnpm mock-api >"$log" 2>&1 &
echo $! >"$pidfile"
echo "mock-api started (pid $(cat "$pidfile"), port $MOCK_API_PORT, log $log)"

# react-native-workflows' android-emulator.sh reverses $WORKFLOWS_MOCK_API_PORT, which
# still defaults to the pre-APP_PORT_BASE 4000; reverse the port the app really
# calls. No-op on the iOS job (no adb) and idempotent when the emulator already
# has it. Remove once the workflows repo derives its ports from the same base.
if command -v adb >/dev/null 2>&1 && adb devices | sed -n '2,$p' | grep -qw device; then
  adb reverse "tcp:$MOCK_API_PORT" "tcp:$MOCK_API_PORT" || true
fi

if ! bash scripts/e2e/wait-for-mock-api.sh; then
  echo "--- tail of $log ---" >&2
  tail -50 "$log" >&2 || true
  exit 1
fi
echo "mock-api is up"
