#!/usr/bin/env bash
# Maestro, the native E2E runner, at the version versions.env pins. Installed
# from the checksummed release archive into ~/.maestro (MAESTRO_DIR), not with
# the curl|bash installer, which also appends to ~/.zshrc and ~/.bash_profile.
# .mise.toml puts ~/.maestro/bin on PATH. Idempotent.
#
#   bash scripts/setup/maestro.sh
set -euo pipefail
. "$(dirname "$0")/lib.sh"
parse_common_args "$@"
use_mise_env # Maestro is a JVM app: it needs mise's java

DIR="${MAESTRO_DIR:-$HOME/.maestro}"
BIN="$DIR/bin/maestro"

step "Maestro $MAESTRO_VERSION"
current="$("$BIN" --version 2>/dev/null | tail -1 || true)"
if [ "$current" = "$MAESTRO_VERSION" ]; then
  ok "maestro $current ($BIN)"
  exit 0
fi
[ -n "$current" ] && info "replacing maestro $current"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
retry 3 curl -fsSL -o "$work/maestro.zip" \
  "https://github.com/mobile-dev-inc/maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip"
sha_ok 256 "$MAESTRO_SHA256" "$work/maestro.zip" || die "refusing an unverified Maestro download"
unzip -q "$work/maestro.zip" -d "$work"
mkdir -p "$DIR"
rm -rf "${DIR:?}/bin" "${DIR:?}/lib"
mv "$work/maestro/bin" "$work/maestro/lib" "$DIR/"

installed="$("$BIN" --version 2>/dev/null | tail -1 || true)"
[ "$installed" = "$MAESTRO_VERSION" ] || die "maestro reports '$installed' after installing $MAESTRO_VERSION"
ok "maestro $installed ($BIN)"
