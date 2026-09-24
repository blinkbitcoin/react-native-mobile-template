#!/usr/bin/env bash
# Shared helpers for scripts/setup/*.sh. Sourced, never run.
#
# Every setup script is idempotent: it checks before it changes anything, so a
# second run on a ready machine only prints "ok" lines. That is what lets CI
# call `make setup` on every fresh runner and a laptop re-run it after an
# upgrade without thinking.

# Repository root, whatever the caller's working directory.
SETUP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export SETUP_ROOT

# shellcheck source=scripts/setup/versions.env
. "$SETUP_ROOT/scripts/setup/versions.env"

step() { printf '\n==> %s\n' "$*"; }
ok() { printf '  ok    %s\n' "$*"; }
info() { printf '  ..    %s\n' "$*"; }
warn() { printf '  warn  %s\n' "$*" >&2; }
die() {
  printf '  FAIL  %s\n' "$*" >&2
  exit 1
}

have() { command -v "$1" >/dev/null 2>&1; }

# `darwin` or `linux`; anything else is refused by the scripts that care.
os() { uname -s | tr '[:upper:]' '[:lower:]'; }

# retry <attempts> <command...>: re-runs a flaky network step with a growing
# pause. The Android SDK and Maven downloads reset mid-transfer often enough
# that a single attempt is how a clean machine ends up half-installed.
retry() {
  local attempts="$1" n=1
  shift
  until "$@"; do
    if [ "$n" -ge "$attempts" ]; then
      warn "gave up after $attempts attempts: $*"
      return 1
    fi
    warn "attempt $n of $attempts failed, retrying in $((n * SETUP_RETRY_DELAY))s: $*"
    sleep $((n * SETUP_RETRY_DELAY))
    n=$((n + 1))
  done
}

# consent <what>: an explicit yes is required before anything that accepts a
# licence or downloads gigabytes. SETUP_YES=1 (or --yes) is that yes for CI;
# without it, an interactive terminal is asked and anything else refuses.
consent() {
  [ "${SETUP_YES:-0}" = 1 ] && return 0
  if [ -t 0 ]; then
    local answer
    printf '  ??    %s [y/N] ' "$1"
    read -r answer
    case "$answer" in y | Y | yes | YES) return 0 ;; esac
  fi
  die "not confirmed: $1. Re-run with SETUP_YES=1 (make setup ARGS=--yes) to agree non-interactively."
}

# set_env_local KEY VALUE: records a per-machine value in .env.local, which
# .mise.toml loads (`_.file`) and derives PATH entries from. Replaces an
# existing KEY line, never duplicates it; the file is gitignored.
set_env_local() {
  local file="$SETUP_ROOT/.env.local" key="$1" value="$2" tmp
  touch "$file"
  tmp="$(mktemp)"
  grep -v "^${key}=" "$file" >"$tmp" || true
  printf '%s=%s\n' "$key" "$value" >>"$tmp"
  mv "$tmp" "$file"
}

# sha_ok <algorithm> <expected> <file>: checksum gate for every download.
sha_ok() {
  local actual
  actual="$(shasum -a "$1" "$3" | cut -d' ' -f1)"
  [ "$actual" = "$2" ] || {
    warn "checksum mismatch for $3: expected $2, got $actual"
    return 1
  }
}

# use_mise_env: puts mise's pinned java/ruby/node first on PATH for the rest of
# the calling script. Needed by sdkmanager (java), gem (ruby) and Maestro (java).
use_mise_env() {
  have mise || die "mise is not installed. Run: make setup-toolchain"
  eval "$(cd "$SETUP_ROOT" && mise env --shell bash)"
}

# Common flags. Scripts call `parse_common_args "$@"` and read the globals.
SETUP_BOOT=0
parse_common_args() {
  for arg in "$@"; do
    case "$arg" in
      --yes | -y) SETUP_YES=1 ;;
      --boot) SETUP_BOOT=1 ;;
      *) die "unknown argument: $arg (known: --yes, --boot)" ;;
    esac
  done
  export SETUP_YES SETUP_BOOT
}
