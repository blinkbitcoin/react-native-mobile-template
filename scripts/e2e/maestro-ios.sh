#!/usr/bin/env bash
# Local iOS E2E: assumes `make ios` already installed the dev build on a booted
# simulator and Metro is running (make start). CI uses react-native-workflows.
set -euo pipefail
cd "$(dirname "$0")/../.."
bash scripts/e2e/wait-for-mock-api.sh
APP_ID="${APP_ID:-com.example.rnmt.dev}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-120000}"
maestro test .maestro --config .maestro/config.yaml -e APP_ID="$APP_ID" \
  --debug-output .maestro/output --flatten-debug-output "$@"
