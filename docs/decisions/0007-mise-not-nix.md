# 7. `mise` pins the toolchain, not Nix

- **Status:** Accepted
- **Date:** 2026-09-05

## Context

A React Native build touches Node, pnpm, Java, Ruby and a handful of linters,
and "works on my machine" is usually a version skew in one of them. The options
are a hermetic environment (Nix) or a version manager that pins tools but uses
the machine's Xcode and Android SDK. Nix buys reproducibility at the price of
an onboarding cliff, friction with Xcode, and a language to learn first.

## Decision

`mise` is the single version pin for humans and CI, with a `doctor` script for
what mise cannot install.

- `.mise.toml` — node 24, pnpm 12, java temurin-17, ruby 3.3, plus
  `actionlint`, `shellcheck`, `typos`; `EXPO_NO_TELEMETRY=1`.
- CI reads the same file through `jdx/mise-action`, so a local green run and a
  CI green run use the same versions.
- `scripts/doctor.mjs` + `doctor.requirements.json` (`make doctor`) — checks
  Xcode, watchman, the Android SDK and the mise tools against minimum versions
  and prints the fix for each miss.

## Consequences

Onboarding is `mise trust && mise install && make doctor`, and the pin cannot
drift between laptop and CI. The environment is not hermetic: Xcode, the
Android SDK and CocoaPods come from the machine, which is why `make doctor`
exists and why its requirements file records a new minimum. mise compiles Ruby
from source on macOS, so fastlane CI jobs use `ruby/setup-ruby` instead.

## Alternatives

- **Nix or devenv** — rejected: onboarding cost and Xcode friction outweigh the
  reproducibility for a store app.
- **asdf** — rejected: mise is a drop-in with a maintained GitHub Action.
- **Docker for local dev** — rejected: iOS builds cannot run in it.
