# Agent guide

Expo SDK 57 store-app template (React Native 0.86, expo-router, Apollo, Lingui,
TypeScript). Continuous Native Generation: `ios/` and `android/` are build
output, never source. CI lives in a reusable-workflow repo
(`blinkbitcoin/shared-workflows`); this repo only pins and calls it.

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
scripts/            check-*.sh, doctor, init, hooks/, release/ (verify, notes, version), e2e/, badges/
scripts/setup/      make setup: toolchain, Maestro, Android SDK + emulator, iOS (setup.test.mjs)
scripts/security/   the check-security scanners, their settings resolver and the verdict
scripts/lib/llm/    provider-portable LLM adapters (store notes, security review)
.maestro/           Maestro flows (native e2e); e2e/web/ is Playwright
fastlane/           store lanes + metadata; deploy/ota/ is the update server
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
| `make gen-badges` | Render the CI badges into `coverage/badge/` (after `make test-coverage`) |

| Fixers | |
|---|---|
| `make fix-format` | Format everything with Biome (writes) |
| `make fix-lint` | Apply Biome's and ESLint's own fixes (writes) |

| Gates | |
|---|---|
| `make check` | Every static gate the `check-code` workflow runs (no tests/builds) |
| `make ci` | Everything CI runs except E2E — `check` plus coverage and the script tests |
| `make check-slow` | The minutes-long gates: prebuild output + the bundle scan (off by default in CI too) |
| `make check-code` | `check-types` + `check-lint` + `check-format` + `check-unused` + `check-spell` |
| `make check-types` | `tsc --noEmit` |
| `make check-lint` | Biome lint + ESLint (React/Expo rules) |
| `make check-format` | Check formatting without writing (`make fix-format` writes) |
| `make check-unused` | Unused files, exports and dependencies |
| `make check-spell` | Spell-check with typos |
| `make check-gen` | Generated-file drift (i18n, codegen) |
| `make check-deps` | SDK drift, audit, lockfile provenance, licenses |
| `make check-ci` | actionlint + zizmor (workflows) + shellcheck (scripts) |
| `make check-docs` | Docs freshness, this file's command table vs the Makefile, table widths, mermaid blocks |
| `make check-skills` | Only the offline skill tests under `.claude/skills/` (part of `make check-release`, which CI runs) |
| `make check-prebuild` | Prebuild both platforms in a temp dir, assert plugin output |
| `make check-release` | Ruby syntax + fastlane lane parse + lane unit tests + skill tests |
| `make check-secrets` | gitleaks over the whole git history; allowlisted test data in `.gitleaks.toml` |
| `make check-security` | Every enabled security scanner, then the verdict (see `docs/security.md`) |
| `make check-security-deps` | Known vulnerabilities and malicious packages in the lockfile (osv-scanner) |
| `make check-security-code` | Semgrep over app source: TypeScript, secrets, OWASP packs plus `rules/` |
| `make check-security-policy` | Assert the pnpm install policy: release cooldown, no implicit builds, no trust downgrade |
| `make check-security-sbom` | CycloneDX bill of materials from the lockfile into `.security/sbom.cdx.json` |
| `make check-security-bundle` | Export the bundle; flag private variable names, secrets and cleartext URLs in it |
| `make check-security-mobile` | mobsfscan over a fresh prebuild of `android/` and `ios/` |
| `make check-security-binaries` | MASTG checks over built binaries (`APK=...` and/or `IPA=...`) |
| `make check-security-review` | LLM security review of the diff (off by default; needs `llm.provider` and a key) |
| `make check-security-review-codebase` | LLM security review of the whole codebase with OpenAnt (off by default; needs `llm.provider` and a key) |
| `make check-code-scanning` | CodeQL code scanning with the same config CI uses (needs a CodeQL CLI; not in `make check`) |

| Tests | |
|---|---|
| `make test` | Unit tests + code checks |
| `make test-unit` | Unit + component tests |
| `make test-scripts` | `node:test` for `scripts/**/*.test.mjs`, with the 100% coverage gate over `scripts/**/*.mjs` |
| `make test-coverage` | Tests with the coverage thresholds and the empty-row check CI enforces |
| `make test-e2e-ios` | Maestro flows on iOS (needs `dev-api`, `dev`, `dev-ios`) |
| `make test-e2e-android` | Maestro flows on Android (needs `dev-api`, `dev`, `dev-android`) |
| `make test-e2e-web` | Web export (dev env, mock API) + Playwright smoke |

| Release | |
|---|---|
| `make version` | Print what CI would build for HEAD |
| `make release-notes` | Preview store notes for HEAD (`TAG=vX.Y.Z` uses that release body, `PR=N` that release PR's body) |
| `make verify-ios` | Verify a built .app/.ipa/.xcarchive (`ARTIFACT=...`) |
| `make verify-android` | Verify AAB+APK (`AAB=... APK=...`) |

## Rules of the road

- **Native output is never committed.** `ios/` and `android/` are gitignored
  prebuild output. `src/graphql/generated/**` and `src/i18n/locales/*/messages.ts`
  *are* committed, but only ever as the output of `make gen-graphql` / `make gen-i18n` —
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
- **Never set a locale as a command prefix in shell code.** Write
  `env LC_ALL=C grep ...`, not `LC_ALL=C grep ...`: with the prefix a Homebrew
  bash on macOS switches its own locale inside `$(...)` or a pipeline and now
  and then dies with SIGSEGV (status 139). `scripts/shell-locale.test.mjs`
  fails on the prefix and names the line.
- **User-visible strings go through Lingui** (`t`/`Trans` macros), then
  `make gen-i18n`. No bare literals in JSX.
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
- **Worktrees under `.claude/worktrees/` are not this checkout.** Claude Code
  puts whole checkouts there, node_modules included, so every tool that walks
  the tree excludes the directory itself (Jest and Metro anchored to the root,
  since a worktree's own root is under it too). A new tool adds its entry;
  `scripts/worktree-ignores.test.mjs` holds the existing ones, and
  `docs/quality.md` lists them.
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
  from `release-notes.prompt.md`; to change them, edit the prompt (the next
  push regenerates) or the release body after merging, then preview with
  `make release-notes` — see `docs/release-runbook.md`.
- **No vague abbreviations, anywhere a human reads.** Write the word:
  identifiers, organisation, credentials, repository, configuration,
  environment. This applies to prose, plans, commit messages, comments and
  names alike. Keep an abbreviation only when it is the industry's own name
  for the thing (App Store Connect's `ASC_`, OTA, 2FA, API, JSON, CI, CD) and
  expand an uncommon one on first use. A prefix made of the family's initials
  was rejected for exactly this reason; so was "ids" for identifiers in a
  status message.
- **A make target is named for what it checks or does, never after the tool
  that does it.** `check-unused`, not `check-knip`; `check-code-scanning`, not
  `check-codeql`. A tool's name tells a reader nothing until they already know
  the tool; it belongs in the `##` description, where `make help` shows it.
  `scripts/make-target-names.test.mjs` fails on a target with a word that names
  a tool pinned in `.mise.toml` or a package in `package.json`; a `setup-`
  target installs the tool it names, and any other exception needs an entry
  with its reason.
- **Workflow files carry their stage in the name.** GitHub reads only the top
  level of `.github/workflows/`, so the prefix is the only grouping there is:
  `ci.yml` and `ci-*.yml` run on every change and display as `CI` /
  `CI / ...`; `cd-*.yml` make releases and display as `CD / ...`. A new
  workflow takes the prefix and the matching display name
  (`scripts/workflow-names.test.mjs` fails otherwise). A rename updates every
  reference in the same PR, not just the ones spelled `.yml`: `uses:` paths,
  `gh workflow run` targets, `require-green-workflow`, `workflow_run` listeners
  (they match the display name), the init manifest, docs, diagrams, README
  tables and "Actions → ..." paths (the sidebar shows display names). Before
  pushing, `git grep` the old name without its suffix. Only `CHANGELOG.md`,
  `docs/superpowers/` and concurrency group names (renaming one changes which
  runs queue together) may still hold it.
- **Every PR tests everything it adds or changes, in the same PR.** That means
  the happy path, every error path and every branch a reviewer could ask
  about, and the PR description names the tests that cover the change. Where a
  tool measures coverage the gate is 100%: Jest over `src/`, `plugins/` and
  `modules/*/index.ts` (lines, branches, functions, statements), and
  `node:test` over `scripts/**/*.mjs` (lines, branches, functions; `make
  test-scripts`). Code no tool measures here is held to the same bar by
  review: an end-to-end flow per user-facing flow, a `fastlane/test/` case per
  lane, a `scripts/*.test.mjs` assertion per workflow rule. A threshold is never lowered and no file is excluded from
  coverage to make a PR pass; if something truly cannot be tested, the PR says
  what and why.
- **Docs and diagrams ship in the same PR as the change, never as a
  follow-up.** Any change to a name, input, output, job, file, flow, count or
  default updates every doc that describes it, in the same PR: prose, tables,
  README and AGENTS.md, and every diagram (mermaid blocks, ASCII drawings in
  code fences, SVGs under `docs/assets/`). Before pushing, `git grep` each
  thing the diff renamed or changed, spelled every way a reader would meet it
  (with and without `.yml`, the display name, the job name), and read each
  diagram that shows the part you touched; a diagram that still draws the old
  flow is drift even when no text search finds it. The PR description names
  the docs it updated, or says why none needed to change. Mechanically
  enforced on top: architecture-relevant changes without a `docs/` change get
  a warning from `make check-docs` (a dependency bump does not count, and
  Dependabot is exempt); adding a make target without a row in the table above
  is a hard failure, and so is a markdown table cell wider than 120 visible
  characters (break it with `<br>`) or a fenced `mermaid` block that does not
  parse.

## Testing map

| Layer | Where | Run with |
|---|---|---|
| Units, components, router, Apollo (MSW) | `src/**/*.test.ts(x)` | `make test-unit` |
| Config plugins | `plugins/*.test.ts` | `make test-unit` |
| Node scripts (release, doctor, init, checks), 100% coverage | `scripts/**/*.test.mjs` | `make test-scripts` |
| Machine setup (`make setup`), bash against fake tools | `scripts/setup/setup.test.mjs` | `make test-scripts` |
| The native-setup skill's commands and paths | `.claude/skills/native-setup/tests/` | `make check-skills` |
| Fastlane lanes | `fastlane/test/` | `make check-release` |
| Native e2e | `.maestro/flows/` | `make test-e2e-ios`, `make test-e2e-android` |
| Web e2e | `e2e/web/` | `make test-e2e-web` |

Coverage (`jest.config.ts`) is 100% lines, branches, functions and statements,
globally. New code needs a test in the same commit. A file with nothing to
assert goes in `coveragePathIgnorePatterns` **with a one-line reason**; an entry
without one is not mergeable, and a native module's TS wrapper does not qualify
just because the native half is Swift/Kotlin. `make test-coverage` (and CI, through
`test:coverage`) also fails on any file with zero statements (`scripts/check-coverage-empty.mjs`), so a re-export
barrel cannot lift the number while testing nothing.

The Node scripts have their own gate: `test:scripts` (`make test-scripts`, CI's
Unit job) runs `node:test` with its built-in coverage at 100% lines, branches
and functions over every `scripts/**/*.mjs` module. A script's command-line
entry is an exported `main(argv, io)` that returns the exit code, tested
in-process; the entry itself is only an `import.meta.main` guard that sets
`process.exitCode` from `main`, which one subprocess run per script covers. See `docs/testing.md`.

## CI, release and troubleshooting

- CI is four callers into `blinkbitcoin/shared-workflows`, pinned by SHA —
  `docs/ci.md` maps each `make` target to its CI job and explains `.workflows/`.
- Releases (versions, build numbers, store notes, environments, rollback,
  hotfix): `docs/release-runbook.md`. Over-the-air updates and the channel
  model: `docs/ota.md`.
- A machine that will not build or test natively: `make setup` first, then the
  symptom table in `.claude/skills/native-setup/SKILL.md`.
- Local setup, first run and the Metro/pod/watchman troubleshooting table:
  `docs/local-dev.md`. Tool ownership (Biome vs ESLint) and how to suppress a
  rule correctly: `docs/quality.md`. Folder map and data flow:
  `docs/architecture.md`.
- Contributing workflow and PR expectations: `CONTRIBUTING.md`. Vulnerability
  reports: `SECURITY.md`.
