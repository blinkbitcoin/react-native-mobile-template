# Agent guide

Expo SDK 57 store-app template (React Native 0.86, expo-router, Apollo, Lingui,
TypeScript). Continuous Native Generation: `ios/` and `android/` are build
output, never source. CI lives in a reusable-workflow repo
(`blinkbitcoin/shared-workflows`); this repo only pins and calls it.

Read this file before touching anything. `make help` is the source of truth for
commands, and `make check-docs` (the shared `check-docs`) fails the build if it
and the table below drift apart.

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
scripts/            init, e2e/ and the guards (*.test.mjs) only this repository has
.maestro/           Maestro flows (native e2e); e2e/web/ is Playwright
fastlane/           store lanes + metadata
docs/               architecture, local-dev, quality, testing, ci, native-extensions,
                    release-runbook, ota, ota-and-crash-reporting, template-usage, decisions/
```

## Commands

Every row is a make target; nothing here is run through pnpm directly. Targets
are grouped by prefix, the same way the workflow files are: `check-` is a static
gate, `test-` runs tests, `build-` produces an artifact, `dev-` runs the app
locally, `gen-` writes generated files, `fix-` rewrites source in place,
`verify-` inspects a built artifact. `check`, `test` and `ci` are the
aggregates.

| Setup | |
|---|---|
| `make init` | Rename this template into your app, then delete itself (template only; `docs/template-usage.md`) |
| `make setup` | Blank machine to ready, idempotent: toolchain, deps, Maestro, Android SDK + emulator, iOS (`ARGS="--yes --boot"` for CI) |
| `make setup-toolchain` | mise + pinned tools, watchman, then `make install` |
| `make setup-android` | Android SDK, build packages, the emulator; records `ANDROID_HOME` in `.env.local` |
| `make setup-ios` | Xcode checks, the iOS simulator runtime, CocoaPods |
| `make setup-maestro` | Maestro at the pinned version, from the checksummed release |
| `make doctor` | Check the local toolchain (run this first) |
| `make install` | Install dependencies (pnpm + Ruby gems) and git hooks |
| `make clean` | Remove generated native projects, caches and build output |
| `make reset` | clean + reinstall |
| `make help` | Show every target with its description |

| Run | |
|---|---|
| `make ports` | Print the ports derived from `APP_PORT_BASE` |
| `make dev` | Metro for the dev client (`APP_PORT_BASE`+1) |
| `make dev-ios` | Prebuild if needed, build and launch on the iOS simulator |
| `make dev-android` | Prebuild if needed, build and launch on an Android emulator |
| `make dev-web` | Expo web dev server |
| `make dev-api` | Local GraphQL mock API (`APP_PORT_BASE`+2) |
| `make prebuild` | Regenerate `ios/`/`android/` locally (plugin debugging only) |
| `make build-web` | Static web export into `dist/` |

| Codegen | |
|---|---|
| `make gen-i18n` | Extract + compile Lingui catalogs |
| `make gen-graphql` | Regenerate typed GraphQL documents |
| `make gen-badges` | Render the CI badges into `coverage/badge/` (after `make test-coverage`; Security after `make check-security`) |

| Fixers | |
|---|---|
| `make fix-format` | Format everything with Biome (writes) |
| `make fix-lint` | Apply Biome's and ESLint's own fixes (writes) |
| `make fix-tooling-pin` | Point the shared tooling packages at the commit the workflows pin, and relock (writes) |

| Gates | |
|---|---|
| `make check` | Every static gate the `check` workflow runs (no tests/builds) |
| `make ci` | Everything CI runs except E2E — `check` plus coverage and the script tests |
| `make check-slow` | The minutes-long gates: prebuild output + the bundle scan (off by default in CI too) |
| `make check-code` | `check-types` + `check-lint` + `check-format` + `check-unused` + `check-spell` |
| `make check-types` | `tsc --noEmit` |
| `make check-lint` | Biome lint + ESLint (React/Expo rules) |
| `make check-format` | Check formatting without writing (`make fix-format` writes) |
| `make check-unused` | Unused files, exports and dependencies |
| `make check-spell` | Spell-check with typos |
| `make check-generated` | Generated-file drift (i18n catalogs, GraphQL documents) |
| `make check-expo-health` | Expo SDK drift (a warning), then expo-doctor |
| `make check-audit` | Vulnerability audit of production dependencies + lockfile provenance |
| `make check-licenses` | Production dependency licenses against the allowlist |
| `make check-ci` | Shared CI lint (actionlint, zizmor, shellcheck) + workflow names + shell locale prefixes<br>+ ignored directories |
| `make check-docs` | Docs freshness, this file's command table vs the Makefile, make target names, table widths,<br>mermaid blocks (the shared `check-docs`; its rules are in `app-tooling.json`) |
| `make check-skills` | Only the offline skill tests under `.claude/skills/` (part of `make check-release`, which CI runs) |
| `make check-prebuild` | Prebuild both platforms in a temp dir, assert plugin output |
| `make check-release` | Ruby syntax + fastlane lane parse + lane unit tests + skill tests |
| `make check-secrets` | gitleaks over the whole git history (the shared script); allowlisted test data in `.gitleaks.toml` |
| `make check-security` | Every enabled security scanner, then the verdict (see `docs/security.md`) |
| `make check-security-dependencies` | Known vulnerabilities and malicious packages in the lockfile (osv-scanner) |
| `make check-security-code` | Semgrep over app source: TypeScript, secrets, OWASP packs plus `rules/` |
| `make check-security-policy` | Assert the pnpm install policy: release cooldown, no implicit builds, no trust downgrade |
| `make check-security-sbom` | CycloneDX bill of materials from the lockfile into `.security/sbom.cdx.json` |
| `make check-security-bundle` | Export the bundle; flag private variable names, secrets and cleartext URLs in it |
| `make check-security-mobile` | mobsfscan over a fresh prebuild of `android/` and `ios/` |
| `make check-security-binaries` | MASTG checks over built binaries (`APK=...` and/or `IPA=...`) |
| `make check-security-review` | LLM security review of the diff (off by default; needs `llm.provider` and a key) |
| `make check-security-review-codebase` | LLM security review of the whole codebase with OpenAnt (off by default; needs `llm.provider` and a key) |
| `make check-code-scanning` | CodeQL code scanning with the same config CI uses (needs a CodeQL CLI; not in `make check`) |
| `make check-contract` | Everything the called shared workflows need from this repository, in one report<br>(CI runs it as `Checks / Contract`; not in `make check`) |

| Tests | |
|---|---|
| `make test` | Unit tests + code checks |
| `make test-unit` | Unit + component tests |
| `make test-scripts` | `node:test` for `scripts/**/*.test.mjs`, with the 100% coverage gate over `scripts/**/*.mjs` |
| `make test-app` | The shared app suites against this app (the OTA fingerprint); `pnpm exec test-app --list` says which run |
| `make test-coverage` | Tests with the coverage thresholds and the empty-row check CI enforces |
| `make test-e2e-ios` | Maestro flows on iOS (needs `dev-api`, `dev`, `dev-ios`) |
| `make test-e2e-android` | Maestro flows on Android (needs `dev-api`, `dev`, `dev-android`) |
| `make test-e2e-web` | Web export (dev env, mock API) + Playwright smoke |

| Release | |
|---|---|
| `make version` | Print what CI would build for HEAD |
| `make store-notes` | Preview store notes for HEAD (`TAG=vX.Y.Z` uses that release body, `PR=N` that release PR's body) |
| `make verify-ios` | Verify a built .app/.ipa/.xcarchive (`ARTIFACT=...`) |
| `make verify-android` | Verify AAB+APK (`AAB=... APK=...`) |

## Rules of the road

- **Native output is never committed.** `ios/` and `android/` are gitignored
  prebuild output. `src/graphql/generated/**` and `src/i18n/locales/*/messages.ts`
  *are* committed, but only ever as the output of `make gen-graphql` / `make gen-i18n` —
  never hand-edited; `make check-generated` fails on drift.
- **Never `cp -R generated/. .`** when scaffolding from a generator: it clobbers
  `.git/`. Use `rsync -a --exclude .git generated/ .`.
- **Never hardcode a port.** Every port is `APP_PORT_BASE` (default 8080) plus a
  fixed offset, and the `ports` program of `@blinkbitcoin/app-tooling` is the only
  thing that derives one — mise exports the base, the Makefile's run targets eval it. Never
  mirror a derived port into `.mise.toml`: it then reads as a per-service
  override and `APP_PORT_BASE=8090` stops working. `scripts/port-pins.test.mjs`
  fails on a bare literal and names the file; see
  [docs/local-dev.md](docs/local-dev.md).
- **User-visible strings go through Lingui** (`t`/`Trans` macros), then
  `make gen-i18n`. No bare literals in JSX.
- **Secrets go through `src/lib/secure-store`**, never `expo-secure-store`
  directly; key-value state through `src/lib/storage`. Biome's
  `noRestrictedImports` enforces both.
- **Env goes through `src/config/env`** — zod-parsed, `EXPO_PUBLIC_*` only.
  Nothing else may read `process.env` in `src/`.
- **Logging goes through `src/lib/logger`.** `console.*` is a Biome error in
  application code; `noConsole` is off only for `src/lib/logger.ts` (the sink
  itself, in `biome.json`) and, in the shared Biome preset `biome.json` extends,
  for tooling that legitimately writes to stdout: `scripts/**`, `plugins/**`,
  `mocks/**`, `*.config.*`, `codegen.ts`.
- **Tests are silent.** `console.error`/`console.warn` during a test fails it
  (the shared Jest preset's guard, both projects). A console line is usually a
  missing `await waitFor`, not a logging need; a deliberate one opts out with
  `allowConsole(method, matcher)` from
  `@blinkbitcoin/app-tooling/expo/jest/console`, or by spying on the method.
- **Routes-only rule:** files in `src/app/` compose screens from `src/features`
  and `src/components` and may not import `@apollo/client`, `@/graphql`,
  `@/services` or `@/lib`. Only `src/app/_layout.tsx` and
  `src/app/+native-intent.tsx` are exempt.
- **A native change is three things:** the config plugin or local module, a docs
  update, and a passing `make check-prebuild`. Changing `app.config.ts`,
  `plugins/` or `modules/` without all three will not merge.
- **Simulator builds:** run `expo run:ios` / `make dev-ios` in the background and
  poll the log — the process becomes Metro and never exits. Launch the dev
  client by deep link; the simulator cannot find Metro over Bonjour.
- **Branch per change, off `main`**, one logical change per branch; use a git
  worktree when working alongside another change so checkouts do not collide.
- **Conventional commits with a closed scope enum**
  (`commitlint.config.mjs`): `app ui i18n graphql native plugins config tooling
  ci release deps deps-dev docs e2e web`. Squash merges take the PR title as the
  commit message, so the PR title is linted too.
- **Releases are release-please's job.** Merge (squash) the release PR; never
  `sed` a version into `package.json`, `app.config.ts` or the manifest. The
  store notes are drafted into the release PR body by `cd-release.yml`
  from `store-notes.prompt.md`; to change them, edit the prompt (the next
  push regenerates) or the release body after merging, then preview with
  `make store-notes` — see `docs/release-runbook.md`.

## Family rules

The rules every app of the family follows are written once, in
[shared-workflows' AGENTS.md](https://github.com/blinkbitcoin/shared-workflows/blob/main/AGENTS.md#rules-every-app-of-the-family-follows),
and apply here unchanged. The ones to know before a first change:

- **Every PR tests everything it adds or changes**, and every source file has
  its own sibling test that covers it at 100% alone (`foo.mjs` has
  `foo.test.mjs`; a route's test mirrors its path under `src/__tests__/app/`).
  `check-test-siblings` names any file without one.
- **Docs and diagrams ship in the same PR as the change.** Update every doc
  that names what you changed, and read each diagram that shows the part you
  touched; `make check-docs` warns on an architecture change with no `docs/`
  change.
- **No vague abbreviations anywhere a human reads**: write the word.
- **A make target is named for what it checks or does, never after the tool**,
  and a workflow file carries its stage in its name (`ci-*.yml`, `cd-*.yml`).
- **Never set a locale as a command prefix in shell code**: `env LC_ALL=C grep
  ...`, not `LC_ALL=C grep ...`.
- **Worktrees under `.claude/worktrees/` are not this checkout**, so every tool
  that walks the tree excludes the directory.

## Testing map

| Layer | Where | Run with |
|---|---|---|
| Units, components, router, Apollo (MSW) | `src/**/*.test.ts(x)`, one beside each module | `make test-unit` |
| Routes (`src/app/`), one per route file | `src/__tests__/app/**/*.test.ts(x)` | `make test-unit` |
| That every source file has a sibling test | `check-test-siblings`, rules in `app-tooling.json` | `make test-scripts` |
| Config plugins | `plugins/*.test.ts` | `make test-unit` |
| Node scripts (release, doctor, init, checks), 100% coverage | `scripts/**/*.test.mjs` | `make test-scripts` |
| That a version bump moves neither platform's OTA fingerprint, and the shared fingerprint configuration holds | the `fingerprint` app suite in `@blinkbitcoin/app-tooling` | `make test-app` (CI's Checks / App suites) |
| The native-setup skill's commands and paths | `.claude/skills/native-setup/tests/` | `make check-skills` |
| Fastlane lanes | tested in shared-workflows; here `check-release` parses the Fastfile and lists the lanes | `make check-release` |
| CD against the pinned shared workflows: every call's contract, the store-notes chain | `make check-contract` (the shared contract check),<br>the `store-notes` app suite (`make test-app`) | CI's Checks / Contract and Checks / App suites |
| Native e2e | `.maestro/flows/` | `make test-e2e-ios`, `make test-e2e-android` |
| Web e2e | `e2e/web/` | `make test-e2e-web` |

Coverage (the shared Jest preset that `jest.config.ts` calls) is 100% lines,
branches, functions and statements, globally. New code needs a test in the same
commit. A file with nothing to assert goes in `jest.config.ts`'s
`coveragePathIgnorePatterns` **with a one-line reason**; an entry
without one is not mergeable, and a native module's TS wrapper does not qualify
just because the native half is Swift/Kotlin. `make test-coverage` (and CI,
through `test:coverage`) also fails on any file with zero statements
(`check-coverage-empty`, from `@blinkbitcoin/app-tooling`), so a re-export
barrel cannot lift the number while testing nothing.

Global coverage says every line ran somewhere, not that its own test ran it;
the sibling rule in the family rules closes that gap.

The Node scripts have their own gate: `test:scripts` (`make test-scripts`, CI's
Unit job) is the shared `test-scripts` runner: `node:test` with its built-in
coverage at 100% lines, branches and functions over every `scripts/**/*.mjs`
module, and a failure naming any module no test loaded. A script's command-line
entry is an exported `main(argv, io)` that returns the exit code, tested
in-process; the entry itself is only an `import.meta.main` guard that sets
`process.exitCode` from `main`, which one subprocess run per script covers. See `docs/testing.md`.

## CI, release and troubleshooting

- CI and CD are twelve caller workflows into `blinkbitcoin/shared-workflows`,
  every call pinned to one commit SHA that Dependabot moves in one PR, and a PR
  runs the CD calls against that pin ([ADR 0023](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/decisions/app-0023-cd-verified-before-release.md)).
  The shared tooling package (`@blinkbitcoin/app-tooling`) is a git dependency
  at that same commit; run `make fix-tooling-pin` on the Dependabot PR
  ([ADR 0024](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/decisions/app-0024-shared-tooling-at-the-workflows-pin.md)).
  `docs/ci.md` maps each `make` target to its CI job and explains `.workflows/`.
- What this app sets for a release (variables, secrets, environments, store
  listing): `docs/release-runbook.md`; for over-the-air updates: `docs/ota.md`.
  The general procedures (versions, build numbers, rollback, hotfix, the
  channel model, the scanners) are the shared pages in
  [shared-workflows' docs](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/README.md).
- A machine that will not build or test natively: `make setup` first, then the
  symptom table in `.claude/skills/native-setup/SKILL.md`.
- Local setup, first run and the Metro/pod/watchman troubleshooting table:
  `docs/local-dev.md`. Tool ownership (Biome vs ESLint) and how to suppress a
  rule correctly: `docs/quality.md`. Folder map and data flow:
  `docs/architecture.md`.
- Contributing workflow and PR expectations: `CONTRIBUTING.md`. Vulnerability
  reports: `SECURITY.md`.
