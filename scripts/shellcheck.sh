#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# `find`, not a list of fixed-depth globs: a glob list stops at whatever depth
# it spells out, so a script one directory deeper is skipped in silence, and
# scripts/release/lib/ already sits three levels down. The
# workflows repo hit exactly this in its own Makefile and fixed it the same way,
# and its lint-ci.sh - the fallback this script displaces in CI - already uses
# find. A gate that quietly stops covering new files is worse than no gate.
# Skills ship to every adopter, so they are linted like scripts/.
find scripts .claude/skills -name '*.sh' -exec shellcheck -x {} +
