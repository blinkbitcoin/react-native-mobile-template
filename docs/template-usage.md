# Using this template

This file — and `make init` itself — only exist in the template. The first
thing you do in a new repo is run `make init`; it renames the project, can drop
the web target, and then deletes itself.

## 1. Take a copy

Use the GitHub "Use this template" button (or clone and re-point `origin`), then:

```bash
mise trust && mise install   # toolchain (Node, pnpm, Ruby, ...)
make doctor                  # verify it
make install                 # dependencies + git hooks
```

## 2. Run `make init`

```bash
make init
```

It asks for seven things and validates each one:

| Answer | Example | Rules |
| --- | --- | --- |
| App display name | `Acme Wallet` | 2-60 characters, one line |
| Slug | `acme-wallet` | `^[a-z][a-z0-9-]{1,49}$` — the npm/Expo name |
| iOS bundle identifier | `com.acme.wallet` | reverse-DNS, 2+ segments |
| Android package | `com.acme.wallet` | lowercase reverse-DNS, 2+ segments |
| Deep-link scheme | `acme` | `^[a-z][a-z0-9]{1,20}$` — replaces `rnmt://` |
| GitHub owner | `acme` | the org or user that owns the repo |
| Keep the web target? | `n` | see [what `--no-web` removes](#what---no-web-removes) |

Non-interactive (CI, or a scripted scratch copy). `--yes` requires an explicit
`--web` or `--no-web`: there is no safe default for "should this app have a web
build", so it asks rather than guessing.

```bash
make init ARGS='--yes \
  --name "Acme Wallet" --slug acme-wallet --scheme acme \
  --ios-bundle-id com.acme.wallet --android-package com.acme.wallet \
  --owners acme --no-web'
```

To see exactly what would be touched without changing anything:

```bash
make init ARGS=--dry-run            # the --no-web list, matching the prompt default
make init ARGS='--dry-run --web'    # the shorter, web-keeping list
```

A dry run is a real preflight, not just a print: before listing anything it
checks every path, marker and text anchor the manifest names against the files
as they are now. A real run does the same and refuses to start — exit 2, tree
untouched — if any of them has drifted, rather than leaving a half-renamed,
half-stripped repo behind.

`init` is POSIX-only: its rewrites are line-oriented on LF endings and it spawns
sub-processes without a shell. That matches the template's toolchain (mise on
macOS and Linux); Windows is untested.

## 3. What changed

Everything `init` touches is declared in `scripts/init.manifest.json`; the
script itself hard-codes no paths.

**Renamed** — the display name, slug, bundle id, package and scheme in
`app.config.ts`, `package.json`, `release-please-config.json`, the `.env*`
files, `.maestro/flows/deep-link.yaml`, the Maestro launch scripts,
`fastlane/metadata/**` and `fastlane/release-notes-context.md`, the
`certs/README.md` example command, the local Expo module podspec, the release
fixtures and `src/lib/native-intent.ts` with its test, plus every Markdown file
in the repo root, `docs/` and `.github/`.

**Then, in order:** `pnpm install` (the lockfile picks up the new package name
and, with `--no-web`, the removed dependencies), `pnpm codegen` and
`pnpm i18n:check` (both must be no-ops — renaming touches no GraphQL document
and no message id), `pnpm format`, and `make check-code`.

**Deleted** — `scripts/init.mjs`, `scripts/init.test.mjs`,
`scripts/init.manifest.json`, this file, the Makefile's `init` target, the
README's "Using this template" section, and the doc rows that pointed at any of
them. The `// init:web-start` / `// init:web-end` comments go too: with
`--no-web` they take their block with them, with `--web` only the comment lines
go and the block stays.

**Committed** — `chore(app): initialize <slug> from react-native-mobile-template`,
with the git hooks enabled, so commitlint and the pre-commit gate run on it.
Set `INIT_SKIP_COMMIT=1` to leave the tree dirty instead, or
`INIT_SKIP_INSTALL=1` to skip the install and the gates (both are what the
test suite uses).

### What `--no-web` removes

The web target is opt-in. Answering "no" deletes the files listed in
`docs/web-files.txt` (`assets/favicon.png`, `e2e/web/`, `playwright.config.ts`,
`src/app/+html.tsx`, `src/features/settings/NativeDemoCard.web.tsx`) plus
`scripts/e2e/web.sh`, `.github/workflows/web.yml` and the web ADR; drops the
`web`, `build:web` and `test:e2e:web` package scripts, the `web`, `build-web`
and `e2e-web` make targets, the `react-dom`, `react-native-web`,
`@expo/metro-runtime` and `@playwright/test` dependencies, the commitlint `web`
scope and `knip.json`'s `playwright` plugin; and removes the marker-delimited
web blocks from `app.config.ts`, `metro.config.js` and
`.github/workflows/release-production.yml`, the web rows from the docs, and the
web-variant case from `src/features/settings/NativeDemoCard.test.tsx`.

Answering "yes" keeps all of it, and `make e2e-web` keeps working.

## 4. What to do next

1. Set the repository variables and secrets. The authoritative table is in
   [docs/release-runbook.md](release-runbook.md) — `IOS_BUNDLE_ID`,
   `IOS_SCHEME`, `ANDROID_PACKAGE`, the App Store Connect and Play credentials,
   and the `EXPO_PUBLIC_*` values. Nothing in the release path works until they
   exist.
2. Create the `production` GitHub environment with required reviewers (see the
   same runbook) — it is what makes a store release a two-person action.
3. Replace the placeholder assets in `assets/` and the store copy in
   `fastlane/metadata/**`.
4. If you want over-the-air updates, follow [docs/ota.md](ota.md) and generate
   your own signing certificate per [certs/README.md](../certs/README.md); the
   committed certificate is a placeholder.
5. Read [docs/architecture.md](architecture.md), then delete the demo screens
   under `src/features/` and start your own.
