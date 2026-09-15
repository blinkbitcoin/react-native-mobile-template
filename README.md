# react-native-mobile-template

A store-ready Expo (SDK 57) React Native app you can ship from: navigation,
GraphQL, i18n, theming, native-module and config-plugin examples, tests at every
layer, and a release pipeline that already knows how to sign, verify and
publish to both stores.

Continuous Native Generation: `ios/` and `android/` are build output, never
source. CI lives in a reusable-workflow repo
(`blinkbitcoin/react-native-workflows`); this repo pins and calls it.

[![Unit](https://raw.githubusercontent.com/blinkbitcoin/react-native-mobile-template/gh-pages/badges/main/unit.svg)](https://github.com/blinkbitcoin/react-native-mobile-template/actions/workflows/ci.yml)
[![E2E](https://raw.githubusercontent.com/blinkbitcoin/react-native-mobile-template/gh-pages/badges/main/e2e.svg)](https://github.com/blinkbitcoin/react-native-mobile-template/actions/workflows/ci.yml)
[![Coverage](https://raw.githubusercontent.com/blinkbitcoin/react-native-mobile-template/gh-pages/badges/main/coverage.svg)](https://github.com/blinkbitcoin/react-native-mobile-template/actions/workflows/ci.yml)

`ci.yml`'s `badges` job renders these per branch and publishes them to the
`gh-pages` branch as `badges/<branch>/`, so the ones above are `main`'s and
every other branch has its own set. They appear after the first CI run on
`main`; until then GitHub serves a broken image. See
[docs/ci.md](docs/ci.md#badges).

## 60-second start

```sh
mise trust && mise install   # toolchain: Node, pnpm, Ruby, Java
make doctor                  # verify it (prints one line per tool)
make install                 # pnpm dependencies, Ruby gems, git hooks
make mock-api                # terminal 1: GraphQL mock API (make ports says where)
make start                   # terminal 2: Metro for the dev client
make ios                     # or: make android — builds and launches
make check && make unit      # every static gate, then the tests
```

`make help` lists every target; `AGENTS.md` is the rules-of-the-road file for
humans and coding agents alike.

<!-- init:usage-start -->
## Using this template

Press "Use this template" on GitHub, then run `make init`: it renames the
project, optionally drops the web target, and deletes itself. The full walkthrough
— what it asks, what it rewrites and what to do afterwards — is in
[docs/template-usage.md](docs/template-usage.md).
<!-- init:usage-end -->

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

## Documentation

[docs/README.md](docs/README.md) is the index — it says which page answers
which question. Start with [docs/local-dev.md](docs/local-dev.md) to get the app
running and [docs/architecture.md](docs/architecture.md) for the layout.

## CI and releases

- **CI**: every push runs the same gates as `make check`, `make unit` and the
  e2e suites, through the pinned reusable workflows — see [docs/ci.md](docs/ci.md).
- **Releases**: release-please opens the version PR; merging it tags, builds,
  verifies and submits to TestFlight and Play — see
  [docs/release-runbook.md](docs/release-runbook.md).

## Licence

MIT — see [LICENSE](LICENSE).
