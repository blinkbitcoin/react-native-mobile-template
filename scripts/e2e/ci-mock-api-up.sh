#!/usr/bin/env bash
# E2E setup hook (react-native-workflows `e2e-setup-script`): start the local
# GraphQL mock API in the background and wait until it answers.
# Run from the consumer root by $RNW/scripts/e2e/run-hook.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."

out="${RNW_OUT:-/tmp}"
mkdir -p "$out"
log="$out/mock-api.log"
pidfile="$out/mock-api.pid"

nohup pnpm mock-api >"$log" 2>&1 &
echo $! >"$pidfile"
echo "mock-api started (pid $(cat "$pidfile"), log $log)"

if ! bash scripts/e2e/wait-for-mock-api.sh; then
  echo "--- tail of $log ---" >&2
  tail -50 "$log" >&2 || true
  exit 1
fi
echo "mock-api is up"
