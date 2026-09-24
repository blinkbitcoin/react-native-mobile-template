#!/usr/bin/env bash
# `make setup`: a blank machine to one that passes `make doctor` and can run
# `make dev-android`, `make dev-ios` and both E2E suites. Each part is idempotent, so
# this is also the answer to "something in my toolchain is off": run it again.
#
#   bash scripts/setup/all.sh [--yes] [--boot]
set -euo pipefail
here="$(dirname "$0")"

bash "$here/toolchain.sh" "$@"
bash "$here/maestro.sh"
bash "$here/android.sh" "$@"
bash "$here/ios.sh" "$@"

# The doctor reads PATH, so it runs inside mise's environment, where
# .env.local's ANDROID_HOME puts adb and maestro on PATH.
cd "$here/../.."
mise exec -- make doctor
