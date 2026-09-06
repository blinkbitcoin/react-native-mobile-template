#!/usr/bin/env bash
# E2E teardown hook (react-native-workflows `e2e-teardown-script`): stop the
# mock API started by ci-mock-api-up.sh. Never fails the job it is cleaning up
# after — teardown runs with `if: always()`, including after a failed suite.
set -euo pipefail

out="${RNW_OUT:-/tmp}"
pidfile="$out/mock-api.pid"

if [ -f "$pidfile" ]; then
  pid="$(cat "$pidfile")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    echo "mock-api (pid $pid) stopped"
  else
    echo "mock-api (pid ${pid:-?}) was no longer running"
  fi
  rm -f "$pidfile"
else
  echo "no $pidfile - nothing to stop"
fi
exit 0
