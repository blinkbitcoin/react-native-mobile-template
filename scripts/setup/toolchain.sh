#!/usr/bin/env bash
# The shared toolchain every platform needs: mise and the versions it pins
# (.mise.toml: node, pnpm, java, ruby and the linters), watchman on macOS,
# then the project's own dependencies. Idempotent.
#
#   bash scripts/setup/toolchain.sh [--yes]
set -euo pipefail
. "$(dirname "$0")/lib.sh"
parse_common_args "$@"

step "mise"
if ! have mise; then
  if [ "$(os)" = darwin ] && have brew; then
    info "installing mise with Homebrew"
    retry 3 brew install mise
  else
    # The official installer is a remote script, so it is asked about first.
    consent "Download and run the mise installer from https://mise.run"
    retry 3 bash -c 'curl -fsSL https://mise.run | sh'
    export PATH="$HOME/.local/bin:$PATH"
  fi
fi
have mise || die "mise is not on PATH after installing it. Add ~/.local/bin to PATH and re-run."
ok "mise $(mise --version 2>/dev/null | cut -d' ' -f1)"

# An untrusted .mise.toml is silently ignored for tools and env alike: java
# then resolves to macOS's /usr/bin/java stub ("Unable to locate a Java
# Runtime") and ruby to whatever else is on PATH.
mise trust --quiet "$SETUP_ROOT/.mise.toml"
ok "trusted $SETUP_ROOT/.mise.toml"

step "pinned tools (node, pnpm, java, ruby, linters)"
retry 3 mise install --yes
# From here on this script, and anything it runs, sees mise's versions.
eval "$(cd "$SETUP_ROOT" && mise env --shell bash)"
ok "java $(java -version 2>&1 | head -1 | cut -d'"' -f2), ruby $(ruby -e 'print RUBY_VERSION'), node $(node --version)"

if [ "$(os)" = darwin ]; then
  step "watchman"
  if have watchman; then
    ok "watchman $(watchman --version)"
  else
    have brew || die "watchman needs Homebrew (https://brew.sh), which is not installed"
    retry 3 brew install watchman
    ok "watchman $(watchman --version)"
  fi
fi

step "project dependencies (make install)"
# After mise, never before: gems installed under another Ruby land in
# vendor/bundle/ruby/<that version> and `bundle check` then fails.
retry 3 make -C "$SETUP_ROOT" install
ok "pnpm packages, Ruby gems and git hooks installed"
