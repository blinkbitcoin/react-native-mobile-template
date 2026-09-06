# CI

This repo runs almost no CI logic of its own. Nearly every job lives in
[`blinkbitcoin/react-native-workflows`](https://github.com/blinkbitcoin/react-native-workflows)
and the ten files in `.github/workflows/` are thin callers that pick inputs.
Two of the ten are the exception and are described below. The workflows repo's
`docs/consumer-guide.md` is the contract; this page is the template's half of
it.

## The callers

Ten files, in two groups: four that run on every change, and six that make
releases. The release group is documented in
[release-runbook.md](release-runbook.md) and [ota.md](ota.md); the table below
is the inventory.

### Everyday CI

| File | Trigger | Calls | Notes |
| --- | --- | --- | --- |
| `ci.yml` | `push` to `main` (skipping `docs/**`, `**.md`), `pull_request` (`opened`, `synchronize`, `reopened`, `labeled`), `workflow_dispatch` | `checks.yml`, `unit.yml`, `e2e.yml` | `unit` and `e2e` both `needs: checks` and skip when `checks` reports `docs-only` |
| `web.yml` | `pull_request`, `release: published` | `web.yml` | PR = dev export + Playwright smoke; release = production export + Pages deploy |
| `pr-closed.yml` | `pull_request: closed` | `pr-closed.yml` | cancels the closed PR's in-flight runs; needs `actions: write` |
| `pr-title.yml` | `pull_request: edited` (only when the title changed) | `pr-title.yml` | `opened`/`synchronize` are already covered by `checks.yml`'s `commitlint` |

`push` is deliberately scoped to `main` only: a PR branch in this repo would
otherwise fire both `push` and `pull_request` and run the whole suite twice for
the same commit.

### Release and OTA

| File | Trigger | Calls | Notes |
| --- | --- | --- | --- |
| `release-please.yml` | `push` to `main` (skipping `docs/**`, `**.md`), `workflow_dispatch` | `googleapis/release-please-action@v5`, `actions/create-github-app-token@v2` | Keeps one release PR open. Calls no reusable workflow from the workflows repo |
| `release-internal.yml` | `push` to `main` (same paths-ignore), `workflow_dispatch` | `expo-prepare.yml`, `expo-build-ios.yml`, `expo-build-android.yml`, `fastlane-lane.yml`, `github-release.yml`, `expo-ota-publish.yml` | The only workflow that builds binaries |
| `release-beta.yml` | `release: published`, `workflow_dispatch` (`tag`) | `expo-prepare.yml`, `fastlane-lane.yml`, `github-release.yml`, `expo-ota-publish.yml` | Promotes the binary internal already built and tested. Never builds |
| `release-production.yml` | `workflow_dispatch` (`tag`, `action`) | `expo-prepare.yml`, `fastlane-lane.yml`, `github-release.yml`, `expo-ota-publish.yml`, `web.yml` | `action` selects release, rollout, halt, resume or complete |
| `release-retry.yml` | `workflow_run` on a completed `release-internal` for `main` | nothing: it re-runs a failed beta run with `gh` | Closes the hole where `release: published` fires once, before internal is green |
| `ota-hotfix.yml` | `workflow_dispatch` (`channel`, `ref`, rollout) | `expo-ota-publish.yml` | JavaScript-only fixes. The fingerprint gate rejects anything native |

On a repo that never turns OTA on, the store path still works: only the `ota-*`
jobs are skipped, through `if: vars.OTA_ENABLED == 'true'`, and `ota-hotfix.yml`
skips both of its jobs. See [ota.md](ota.md).

## How CI maps to `make`

Everything CI runs has a local equivalent. The reusable workflows call
`package.json` scripts by name (the "script contract"), which is exactly what
the `make` targets wrap — so a green `make check && make unit && make e2e-ios`
locally means the same commands passed the same way in CI.

| CI job | Scripts it runs | Local equivalent |
| --- | --- | --- |
| `checks.yml` | `typecheck`, `lint`, `format:check`, `knip`, `spell`, `expo-doctor`, `pnpm audit --prod`, commitlint, actionlint, shellcheck | `make check-code`, `make check-deps`, `make check-ci` (`make check` runs all of it) |
| `unit.yml` | `test:coverage`, `test:scripts` | `make coverage`, `make test-scripts` (`make unit` runs `test` + `test:scripts`) |
| `e2e.yml` | Maestro flows in `.maestro/` against a debug build | `make e2e-ios` / `make e2e-android` (after `make mock-api`, `make start`, `make ios`/`make android`) |
| `web.yml` | `build:web`, `test:e2e:web` | `make build-web`, `make e2e-web` |

Two script-contract details are load-bearing:

- `knip` is deliberately **not** a `package.json` script. The workflows'
  `run-script.sh` runs `pnpm run NAME` when the script exists and `pnpm exec
  NAME` when only `node_modules/.bin/NAME` does — both reach the same binary
  here, but a script literally named `knip` fails `expo-doctor`'s
  "Check package.json for common issues" ("scripts in package.json conflict
  with the contents of node_modules/.bin"), which `checks.yml` also runs. The
  binary fallback is the supported path; leave it alone.
- `test:e2e:web` is `bash scripts/e2e/web.sh`, which skips its own export when
  `PLAYWRIGHT_SKIP_EXPORT` is set. `web.yml` exports once in its `build` job,
  uploads the result as the `web-dist` artifact, and sets that variable for the
  Playwright job — the point being that Playwright tests the exact bytes that
  would deploy, not a second, possibly-different export.

## E2E: iOS is opt-in

macOS GitHub-hosted runners bill at 10x, so `e2e.yml`'s `ios` input defaults to
`false` and `ci.yml` passes:

```yaml
ios: ${{ vars.E2E_IOS == 'true' || contains(github.event.pull_request.labels.*.name, 'e2e:ios') }}
```

Two independent ways in:

- **Repo variable** — set `E2E_IOS=true` (Settings → Secrets and variables →
  Actions → Variables) to run iOS on every push and PR.
- **PR label** — add the `e2e:ios` label to a single PR. The `labeled` trigger
  in `ci.yml` is what makes adding the label start a fresh run; a label change
  is not a `synchronize` event, so without it the label would only take effect
  on the next push.

Android runs on every non-docs-only run (`android` defaults to `true`).

`macos-runner` is passed as `${{ vars.RNW_MACOS_RUNNER || 'macos-26' }}`:
set the repo variable `RNW_MACOS_RUNNER` to move iOS onto a different (e.g.
self-hosted) macOS label without editing the workflow. `RNW_MACOS_RUNNER` is a
convention documented by the workflows repo, not a default any workflow applies
on its own — hence the explicit `||` fallback.

## The dev-client launch mechanism

`ci.yml` passes `dev-client: true`, so the E2E jobs start Metro with
`--dev-client` and foreground the app through the
`expo-development-client` deep link rather than a plain launch:

```
rnmt://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081        # iOS
rnmt://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081         # Android (10.0.2.2 is the host from the emulator)
```

This matters because `expo-dev-client`'s launcher screen finds Metro over
Bonjour, which does not work on a simulator or emulator (and certainly not on a
CI runner). Landing on that screen means the suite waits forever for a
"DEVELOPMENT SERVERS" entry that never appears.

Consequences encoded in this repo:

- `.maestro/flows/00-launch.yaml` uses `launchApp: stopApp: false` with **no**
  `clearState`. Restarting or clearing state would throw away the deep-linked
  session and drop the dev client back on its launcher. The launcher taps are
  still in the flow, but every one of them is `optional: true` — a fallback,
  never the happy path.
- `scripts/e2e/maestro-ios.sh` and `scripts/e2e/maestro-android.sh` open the
  same deep link before invoking Maestro, mirroring the workflows repo's
  `scripts/e2e/app-launch.sh`, so a local run and a CI run reach the app the
  same way.

## Mock-API hooks

The flows talk to the local GraphQL mock API (`pnpm mock-api`, port 4000).
`ci.yml` wires the workflows' generic E2E hooks to two small scripts in this
repo:

```yaml
e2e-setup-script: scripts/e2e/ci-mock-api-up.sh
e2e-teardown-script: scripts/e2e/ci-mock-api-down.sh
```

- **Setup** starts `pnpm mock-api` with `nohup`, writes its pid to
  `$RNW_OUT/mock-api.pid` (falling back to `/tmp` outside CI), and blocks on
  `scripts/e2e/wait-for-mock-api.sh` until the server answers a real GraphQL
  query. A missing setup script is fatal — the job fails before the suite runs.
- **Teardown** kills that pid if it is still alive and always exits `0`. It runs
  with `if: always()`, so it must never turn a diagnosable failure into a
  confusing one.

The paths are consumer-relative file paths run with `bash`, not `package.json`
script names. The workflows repo's own `self-smoke.yml` points at these exact
paths, so renaming them breaks that smoke test.

## Forensics

A failed run uploads its evidence as named artifacts — download these from the
run's summary page first:

| Artifact | From | Contents |
| --- | --- | --- |
| `forensics-ios` | `e2e.yml`'s `ios` job | Maestro's `--debug-output` tree (per-flow `commands-*.json`, failure screenshots, `maestro.log`), the simulator screen recording, Metro's log, the device system log, and any crash report from `DiagnosticReports` newer than the run's start stamp (older ones are filtered out so a previous job's crash on the same runner cannot be misread as this one's) |
| `forensics-android` | `e2e.yml`'s `android` job | The same Maestro debug tree, the emulator screen recording, Metro's log and `logcat` |
| `playwright-report` | `web.yml`'s `playwright` job | The Playwright HTML report (traces, screenshots) |
| `coverage` | `unit.yml` | `coverage/`, uploaded on every run (30-day retention) |

The two E2E jobs also pass their builds between jobs as `ios-app` and
`android-apk`; those are plumbing, not forensics.

Locally the same debug tree lands in `.maestro/output/` (gitignored).

## Pinning and bumping the workflows version

Every `uses:` that points at the workflows repo is pinned to the moving major
tag. Eight of the ten files carry at least one, and several carry many:
`release-production.yml` alone has ten. `release-please.yml` and
`release-retry.yml` call no reusable workflow at all.

```yaml
uses: blinkbitcoin/react-native-workflows/.github/workflows/checks.yml@v0
```

`react-native-workflows` is pre-1.0 and release-please-versioned from `0.1.0`;
`v0` is re-pointed at the tip of each `0.x.y` release. So `@v0` picks up fixes
(and, pre-1.0, breaking changes) automatically.

To bump:

- **Pin harder** — replace `@v0` with a full tag (`@v0.3.1`) in every workflow
  file for byte-reproducible runs; you then upgrade deliberately.
- **After the workflows repo reaches 1.0.0** — move all of them to `@v1` in one
  commit and read that release's notes; `v1` behaves the same way (a moving
  major tag), it just tracks a different major line.

Change every `uses:` in one pass, release workflows included. A bump that only
touches the everyday-CI files leaves the release path on the old line, which is
exactly where a version mismatch is hardest to notice. `grep -rn '@v0'
.github/workflows` is the check. All callers share the `.rnw/` self-checkout
and the script contract; mixing versions across them is untested.

## `.rnw/`

Every job checks the workflows repo out into `$GITHUB_WORKSPACE/.rnw` and
reaches its scripts through `$RNW`. Nothing in this repo references
`react-native-workflows` paths directly. Local tooling that walks the whole
tree ignores it: `biome.json` (`!**/.rnw`), `eslint.config.mjs`
(`.rnw/**`), `tsconfig.json` (`exclude`), `typos.toml` (`extend-exclude`) and
`.gitignore` (`/.rnw`).
