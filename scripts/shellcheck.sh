#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
shellcheck -x scripts/*.sh scripts/*/*.sh
