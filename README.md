# react-native-mobile-template

A React Native app is a week's work. Everything around it is the other three
months: the signing that only fails on a Tuesday, the emulator that hangs in
CI, the eleventh linter, the release that needs someone to remember the order.

This repo is those three months, already done. Press **Use this template**, run
`make init`, and you start on day ninety with an Expo app that builds, tests
itself on real devices, and ships to both stores from a merged pull request.

[![Unit](https://raw.githubusercontent.com/blinkbitcoin/react-native-mobile-template/gh-pages/badges/main/unit.svg)](https://github.com/blinkbitcoin/react-native-mobile-template/actions/workflows/ci.yml)
[![E2E](https://raw.githubusercontent.com/blinkbitcoin/react-native-mobile-template/gh-pages/badges/main/e2e.svg)](https://github.com/blinkbitcoin/react-native-mobile-template/actions/workflows/ci.yml)
[![Coverage](https://raw.githubusercontent.com/blinkbitcoin/react-native-mobile-template/gh-pages/badges/main/coverage.svg)](https://github.com/blinkbitcoin/react-native-mobile-template/actions/workflows/ci.yml)

## Getting started

```sh
mise trust && mise install   # toolchain: Node, pnpm, Ruby, Java
make doctor                  # verify it (one line per tool)
make install                 # dependencies, gems, git hooks
make mock-api                # terminal 1: GraphQL mock API
make start                   # terminal 2: Metro for the dev client
make ios                     # or: make android
```

Then `make check && make unit` to run every gate CI runs, and `make help` for
the rest. If a command is not in the Makefile, CI does not know how to run it
either — that is the rule, and `make ci` runs the whole thing locally.

<!-- init:usage-start -->
## Using this template

Press "Use this template" on GitHub, then run `make init`: it renames the
project, optionally drops the web target, and deletes itself. The full walkthrough
— what it asks, what it rewrites and what to do afterwards — is in
[docs/template-usage.md](docs/template-usage.md).
<!-- init:usage-end -->

## The opinions

**`ios/` and `android/` are build output.** Continuous Native Generation, so
native config is a plugin in TypeScript, not a diff someone applied to an Xcode
project two years ago and cannot explain. `make prebuild` regenerates both; you
never commit either.

**CI is a dependency, not a directory.** The workflows live in
[`blinkbitcoin/react-native-workflows`](https://github.com/blinkbitcoin/react-native-workflows)
and this repo pins them at `@v0`. What is left here is eleven short workflow
files saying which ones to run. A fix to the Android emulator boot lands once, for
every app in the family.

**Every gate is a `make` target.** CI runs `make`, so a red build is
reproducible on your laptop by reading the job name, and a new gate is one
Makefile line rather than a YAML negotiation.

**The release path runs without store credentials.** Builds go unsigned,
signing switches on with a repo variable, uploads with another. You can watch a
release work end to end before Apple has answered your email.

## What's inside

| Area | What you get |
| --- | --- |
| App | Expo SDK 57, React Native 0.86, expo-router routes, a themed component kit |
| Data | Apollo Client 4 with retry/auth/error links, a persisted cache, generated typed documents |
| i18n | Lingui 6, `en` + `es` catalogs, extraction and drift checks |
| Native | A local Expo module (`modules/hello-native`) and a config plugin (`plugins/with-build-stamp.ts`) |
| Config | `zod`-parsed `EXPO_PUBLIC_*` env, per-environment `.env` files, a secret-leak gate |
| Tests | Jest + RNTL unit/component, `node:test` for scripts, Maestro on device, Playwright on web |
| Quality | Biome, ESLint, TypeScript, knip, typos, shellcheck, actionlint — all behind `make check` |
| Release | fastlane lanes for both stores, match signing, artifact verification, store notes, `DRY_RUN=1` rehearsal |
| OTA | expo-updates behind an `OTA_ENABLED` toggle, code signing, a self-hosted update server |

## Shipping

Merge a pull request and release-please opens the version PR. Merge that and
the tag, the signed builds, the artifact verification, the GitHub release and
the TestFlight and Play submissions happen without anyone typing a command.
Beta promotion and the staged production rollout are each one dispatch, and a
bad rollout is halted the same way.

[docs/release-runbook.md](docs/release-runbook.md) is the whole path, including
how to rehearse it. [docs/store-accounts.md](docs/store-accounts.md) covers
getting the accounts and credentials in the first place — Apple, Google, Huawei
and Samsung.

## Documentation

[docs/README.md](docs/README.md) says which page answers which question. Two to
start with: [local-dev.md](docs/local-dev.md) to get the app running,
[architecture.md](docs/architecture.md) for how it is laid out. `AGENTS.md` is
the rules-of-the-road file, for humans and coding agents alike.

## Licence

MIT — see [LICENSE](LICENSE).
