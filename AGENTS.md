# Agent guide

Expo SDK 57 store-app template (React Native 0.86, expo-router, Apollo, Lingui,
TypeScript). Continuous Native Generation: `ios/` and `android/` are build
output, never source. CI lives in a reusable-workflow repo
(`blinkbitcoin/react-native-workflows`); this repo only pins and calls it.

Read this file before touching anything. `make help` is the source of truth for
commands, and `scripts/check-docs.sh` fails the build if it and the table below
drift apart.

## Layout

```
src/app/            expo-router routes only (see the routes-only rule)
src/features/       screens and feature logic (home, details, settings)
src/components/     shared presentational components
src/graphql/        Apollo client, links, cache + generated/ (committed, codegen output)
src/i18n/           Lingui runtime + locales/{en,es}/messages.{po,ts}
src/config/         env.ts (zod-parsed EXPO_PUBLIC_*), constants.ts
src/lib/            logger, secure-store, storage, errors, crash-reporting
src/services/       auth, updates
src/theme/          tokens, ThemeProvider, createStyles
src/test/           jest setup, render helper, mocks
plugins/            Expo config plugins (with-*.ts) + their tests
modules/            local native modules (hello-native)
mocks/              GraphQL mock API (server.ts, msw.ts, schema.graphql)
scripts/            check-*.sh, doctor, init, hooks/, release/ (verify, notes, version), e2e/
.maestro/           Maestro flows (native e2e); e2e/web/ is Playwright
fastlane/           store lanes + metadata; deploy/ota/ is the update server
docs/               architecture, local-dev, quality, testing, ci, native-extensions,
                    release-runbook, ota, ota-and-crash-reporting, template-usage, decisions/
```

## Commands

Every row is a make target; nothing here is run through pnpm directly.

| Setup | |
|---|---|
| `make init` | Rename this template into your app, then delete itself (template only; `docs/template-usage.md`) |
| `make doctor` | Check the local toolchain (run this first) |
| `make install` | Install dependencies (pnpm + Ruby gems) and git hooks |
| `make clean` | Remove generated native projects, caches and build output |
| `make reset` | clean + reinstall |
| `make help` | Show every target with its description |

| Run | |
|---|---|
| `make ports` | Print the ports derived from `APP_PORT_BASE` |
| `make start` | Metro for the dev client (`APP_PORT_BASE`+1) |
| `make ios` | Prebuild if needed, build and launch on the iOS simulator |
| `make android` | Prebuild if needed, build and launch on an Android emulator |
| `make web` | Expo web dev server |
| `make mock-api` | Local GraphQL mock API (`APP_PORT_BASE`+2) |
| `make prebuild` | Regenerate `ios/`/`android/` locally (plugin debugging only) |
| `make build-web` | Static web export into `dist/` |

| Codegen | |
|---|---|
| `make i18n` | Extract + compile Lingui catalogs |
| `make codegen` | Regenerate typed GraphQL documents |

| Gates (each is what CI runs) | |
|---|---|
| `make check` | Every static gate CI runs (no tests/builds) |
| `make check-code` | typecheck + lint + format-check + knip + spell |
| `make typecheck` | `tsc --noEmit` |
| `make lint` | Biome lint + ESLint (React/Expo rules) |
| `make format` | Format everything with Biome (writes) |
| `make format-check` | Check formatting without writing |
| `make knip` | Unused files, exports and dependencies |
| `make spell` | Spell-check with typos |
| `make check-gen` | Generated-file drift (i18n, codegen) |
| `make check-deps` | SDK drift, audit, lockfile provenance, licenses |
| `make check-ci` | actionlint (workflows) + shellcheck (scripts) |
| `make check-docs` | Docs freshness, this file's command table vs the Makefile, table widths, mermaid blocks |
| `make check-prebuild` | Prebuild both platforms in a temp dir, assert plugin output |
| `make check-release` | Ruby syntax + fastlane lane parse + lane unit tests |
| `make bundle-secrets-check` | Export the bundle, assert no non-public keys leaked |
| `make codeql` | CodeQL with the same config CI uses (needs a CodeQL CLI; not in `make check`) |

| Tests | |
|---|---|
| `make test` | Unit tests + code checks |
| `make unit` | Unit + component tests |
| `make test-scripts` | `node:test` for `scripts/**/*.test.mjs` |
| `make coverage` | Tests with the coverage thresholds CI enforces |
| `make e2e-ios` | Maestro flows on iOS (needs mock-api, start, ios) |
| `make e2e-android` | Maestro flows on Android (needs mock-api, start, android) |
| `make e2e-web` | Web export (dev env, mock API) + Playwright smoke |

| Release | |
|---|---|
| `make version` | Print what CI would build for HEAD |
| `make release-notes` | Preview store notes for HEAD (`TAG=vX.Y.Z` uses that release body) |
| `make verify-ios` | Verify a built .app/.ipa/.xcarchive (`ARTIFACT=...`) |
| `make verify-android` | Verify AAB+APK (`AAB=... APK=...`) |

## Rules of the road

- **Native output is never committed.** `ios/` and `android/` are gitignored
  prebuild output. `src/graphql/generated/**` and `src/i18n/locales/*/messages.ts`
  *are* committed, but only ever as the output of `make codegen` / `make i18n` —
  never hand-edited; `make check-gen` fails on drift.
- **Never `cp -R generated/. .`** when scaffolding from a generator: it clobbers
  `.git/`. Use `rsync -a --exclude .git generated/ .`.
- **Never hardcode a port.** Every port is `APP_PORT_BASE` (default 8080) plus a
  fixed offset, and `scripts/ports.mjs` is the only thing that derives one —
  mise exports the base, the Makefile's run targets eval the helper. Never
  mirror a derived port into `.mise.toml`: it then reads as a per-service
  override and `APP_PORT_BASE=8090` stops working. `scripts/ports.test.mjs`
  fails on a bare literal and names the file; see
  [docs/local-dev.md](docs/local-dev.md).
- **User-visible strings go through Lingui** (`t`/`Trans` macros), then
  `make i18n`. No bare literals in JSX.
- **Secrets go through `src/lib/secure-store`**, never `expo-secure-store`
  directly; key-value state through `src/lib/storage`. Biome's
  `noRestrictedImports` enforces both.
- **Env goes through `src/config/env`** — zod-parsed, `EXPO_PUBLIC_*` only.
  Nothing else may read `process.env` in `src/`.
- **Logging goes through `src/lib/logger`.** `console.*` is a Biome error in
  application code; `biome.json` turns `noConsole` off only for
  `src/lib/logger.ts` (the sink itself) and for tooling that legitimately writes
  to stdout: `scripts/**`, `plugins/**`, `mocks/**`, `*.config.*`, `codegen.ts`.
- **Tests are silent.** `console.error`/`console.warn` during a test fails it
  (`src/test/console.ts`, both Jest projects). A console line is usually a
  missing `await waitFor`, not a logging need; a deliberate one opts out with
  `allowConsole(method, matcher)` or by spying on the method. The guard and its
  test are the only `noConsole` exemptions besides the ones above.
- **Routes-only rule:** files in `src/app/` compose screens from `src/features`
  and `src/components` and may not import `@apollo/client`, `@/graphql`,
  `@/services` or `@/lib`. Only `src/app/_layout.tsx` and
  `src/app/+native-intent.tsx` are exempt.
- **A native change is three things:** the config plugin or local module, a docs
  update, and a passing `make check-prebuild`. Changing `app.config.ts`,
  `plugins/` or `modules/` without all three will not merge.
- **Simulator builds:** run `expo run:ios` / `make ios` in the background and
  poll the log — the process becomes Metro and never exits. Launch the dev
  client by deep link; the simulator cannot find Metro over Bonjour.
- **Branch per change, off `main`**, one logical change per branch; use a git
  worktree when working alongside another change so checkouts do not collide.
- **Conventional commits with a closed scope enum**
  (`commitlint.config.mjs`): `app ui i18n graphql native plugins config tooling
  ci release deps deps-dev docs e2e web`. Squash merges take the PR title as the
  commit message, so the PR title is linted too.
- **Releases are release-please's job.** Merge (squash) the release PR; never
  `sed` a version into `package.json`, `app.config.ts` or the manifest. Store
  notes prose is edited in the release body, then previewed with
  `make release-notes` — see `docs/release-runbook.md`.
- **Docs ship with the code.** Architecture-relevant changes without a `docs/`
  change get a warning from `make check-docs` (a dependency bump does not count,
  and Dependabot is exempt); adding a make target without a row in the table
  above is a hard failure, and so is a markdown table cell wider than 120
  visible characters (break it with `<br>`) or a fenced `mermaid` block that
  does not parse.

## Testing map

| Layer | Where | Run with |
|---|---|---|
| Units, components, router, Apollo (MSW) | `src/**/*.test.ts(x)` | `make unit` |
| Config plugins | `plugins/*.test.ts` | `make unit` |
| Node scripts (release, doctor, verify) | `scripts/**/*.test.mjs` | `make test-scripts` |
| Fastlane lanes | `fastlane/test/` | `make check-release` |
| Native e2e | `.maestro/flows/` | `make e2e-ios`, `make e2e-android` |
| Web e2e | `e2e/web/` | `make e2e-web` |

Coverage (`jest.config.ts`) is 100% lines, branches, functions and statements,
globally. New code needs a test in the same commit. A file with nothing to
assert goes in `coveragePathIgnorePatterns` **with a one-line reason**; an entry
without one is not mergeable, and a native module's TS wrapper does not qualify
just because the native half is Swift/Kotlin. `make coverage` also fails on any
file with zero statements (`scripts/check-coverage-empty.mjs`), so a re-export
barrel cannot lift the number while testing nothing. See `docs/testing.md`.

## CI, release and troubleshooting

- CI is four callers into `blinkbitcoin/react-native-workflows`, pinned by SHA —
  `docs/ci.md` maps each `make` target to its CI job and explains `.rnw/`.
- Releases (versions, build numbers, store notes, environments, rollback,
  hotfix): `docs/release-runbook.md`. Over-the-air updates and the channel
  model: `docs/ota.md`.
- Local setup, first run and the Metro/pod/watchman troubleshooting table:
  `docs/local-dev.md`. Tool ownership (Biome vs ESLint) and how to suppress a
  rule correctly: `docs/quality.md`. Folder map and data flow:
  `docs/architecture.md`.
- Contributing workflow and PR expectations: `CONTRIBUTING.md`. Vulnerability
  reports: `SECURITY.md`.
