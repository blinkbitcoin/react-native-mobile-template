#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# scripts/release/lib/ holds sourced helpers, hence the third level.
shellcheck -x scripts/*.sh scripts/*/*.sh scripts/*/*/*.sh
