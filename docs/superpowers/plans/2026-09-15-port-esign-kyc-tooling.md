# Port esign/kyc tooling improvements into the React Native template family

## Context

The template family (`react-native-mobile-template` + `react-native-workflows`) was finished on 2026-09-07. Since then two sibling repos moved further on repo-root tooling: `blinkbitcoin/esign` (103 commits since 2026-09-01) and `blinkbitcoin/kyc` (bootstrapped 2026-09-05, ~320 commits, now the strictest of the three). Both converged on conventions the template family either lacks or got subtly wrong. Porting them keeps one house style across four repos and fixes three real defects found while comparing.

Repos: template `~/Dev/blink/react-native-mobile-template` (main, clean), workflows `~/Dev/blink/react-native-workflows` (main, clean). Sources: `~/Dev/blink/esign` (inspect HEAD), `~/Dev/kyc` (inspect via `git show origin/main:<path>`; **never** checkout/fetch, ~22 worktrees hang off it).

### Defects this fixes (verified, not inferred)

1. **The docs-only classifier never classifies a push.** `checks.yml` passes `BASE_SHA: ${{ github.event.pull_request.base.sha }}`, which is empty on push, so every merge to main runs the full matrix. The template compensates with `paths-ignore` on its push trigger, i.e. a second, narrower rule that already disagrees (it misses `LICENSE` and the issue/PR templates). kyc hit exactly this and fixed it in `ab6067d`.
2. **The E2E bundle prewarm warms a graph the app never requests.** `scripts/e2e/metro-wait.sh:43` hand-builds `…virtual-metro-entry.bundle?platform=…&transform.engine=hermes`, but the Expo dev client loads `launchAsset.url` from the manifest, which additionally carries `transform.bytecode=1`, `transform.routerRoot=app` and `unstable_transformProfile=hermes-stable`. Metro keys its graph cache on exactly those (`metro/src/lib/getGraphId.js`), so the first real launch rebuilds from scratch. kyc's `7297eb9` is the same class of fix.
3. **`make check-docs` runs in no CI job.** It is in `make check`, but CI calls individual pnpm scripts, never `make check`. The AGENTS.md command-table gate and the docs-freshness warning are developer-machine-only today.

4. **Two worktrees of the template cannot run side by side.** Metro (8081), the mock API (4000) and the Playwright preview server (8089) are hardcoded across `playwright.config.ts`, `.env.example`, `mocks/server.ts`, `scripts/e2e/wait-for-mock-api.sh`, `maestro-android.sh`'s two `adb reverse` lines and a Maestro flow asserting `http://.*:8081`. kyc solved this with one port base plus fixed offsets.

### Scope decisions (user, this session)

- **In:** everything worth porting — git hooks, repo hygiene, docs-only single source, audit policy, docs checks, silent tests, E2E job shaping, a port base, 100% coverage, a mermaid parse check, CodeQL, and per-branch badges.
- **Out:** only the library-publishing machinery and the pieces listed under Notes, each with a reason.
- **Keep** `pr-title.yml`, `pr-closed.yml`, `release-please.yml`, `release-retry.yml` as separate template files. Consolidating (esign `43659da`) would force a byte-exact coordinated change across `test/fixtures/consumer-min/`, four ```yaml blocks in `docs/consumer-guide.md`, `consumer-contract.bats`, `workflow-shape.bats` and `docs/ci.md` for a cosmetic win.
- **Silent tests:** fail on `console.error` and `console.warn` only; `console.log` stays allowed (RN/Metro tooling logs through it).

---

## PR 1 — Workflows repo: hooks and hygiene

The workflows repo has no hooks, no CODEOWNERS, no CONTRIBUTING, no AGENTS.md. Everything here is new-file work with no consumer contract.

**Hooks.** New `lefthook.yml`: pre-commit (`parallel`, `skip: [merge, rebase]`) running `mise exec -- shellcheck -x {staged_files}` on `*.sh`, `actionlint` gated on `.github/**`, `typos --force-exclude`; commit-msg running commitlint via `npx --yes -p @commitlint/cli@21 -p @commitlint/config-conventional@21` (the exact invocation `scripts/checks/commitlint.sh:47` already proves works, so local and CI resolve identically); pre-push `make check`. No `package.json` — lefthook comes from `.mise.toml` (add a pinned entry). New `commitlint.config.mjs` with a closed scope enum drawn from the real tree: `workflows actions checks ci e2e native ota release self web lib test docs deps tooling`. New `make hooks` target. `.gitignore` gains `lefthook-local.yml`.

**Hygiene.** New `.github/CODEOWNERS`, `PULL_REQUEST_TEMPLATE.md` (checklist rows for the repo's two real contracts: consumer-guide updated, bats added), `ISSUE_TEMPLATE/{bug_report,feature_request,config}.yml`, `CONTRIBUTING.md`, `SECURITY.md`, `AGENTS.md` + `CLAUDE.md` (`@AGENTS.md`), `docs/README.md` index. AGENTS.md carries the **git-worktree rule** from esign `a96dc04`: branch work happens in `git worktree add ../react-native-workflows-<topic> -b <branch> origin/main`, never by switching branches in the shared clone.

**Fixes.** `Makefile`'s `shellcheck` glob is depth-2 (`scripts/*/*.sh`) and misses `scripts/release/lib/`; replace with the `find scripts -name '*.sh'` form already used in `scripts/ci/lint-ci.sh:30`.

**Tests.** `test/hooks.bats` (hook names valid; the commitlint pin agrees with `scripts/checks/commitlint.sh`; the scope list parses, is sorted and unique) and `test/docs-contract.bats` (Makefile `##` targets ↔ `` `make x` `` in AGENTS.md, both directions — a bats port of the template's `check-docs.sh:29-51`). Verify: `make check && mise exec -- lefthook validate`.

## PR 2 — Template: hooks and hygiene

`lefthook.yml`: add `min_version`, `skip: [merge, rebase]` on pre-commit, and replace `… && git add {staged_files}` with `stage_fixed: true` — not cosmetic, since `git add` re-stages unstaged hunks of a partially staged file while `stage_fixed` restages only what the formatter touched. Header and `CONTRIBUTING.md` gain the `lefthook-local.yml` escape hatch; `.gitignore` gains the file.

New `.shellcheckrc` mirroring the workflows repo (`external-sources=true`, `source-path=SCRIPTDIR`) — it has real effect because `scripts/release/lib/` holds sourced helpers. `.gitattributes` gains esign's `*.pbxproj -text` and `*.bat text eol=crlf` (both are `expo prebuild` output that gets diffed by hand during plugin debugging). `.npmrc` gains `fund=false`. `.mise.toml` pins `typos = "1.50.1"` instead of `latest`, matching the workflows repo so the two can never disagree on what a typo is. `biome.json` gains `formatter.useEditorconfig: true` (absent today; commit any resulting reformat separately).

**`.mise.toml` absorbs the useful half of esign's `.envrc`** rather than the template adopting direnv: `[env]` gains `_.path = ["node_modules/.bin"]` (so `biome`, `eslint`, `expo` run without `pnpm exec`) and `_.file = [".env.local"]` for gitignored per-machine overrides. Rationale to record in ADR 0007, which already chose mise over Nix: `mise activate` provides the directory-switching behaviour direnv exists for, and `_.path`/`_.file` provide the rest of what esign's `.envrc` does, so direnv would be a second mechanism for the same job. Nix stays out for the same reason it was rejected originally — its hermetic closure does not extend to Xcode or the Android SDK, which are what actually decide whether an Expo build works on macOS, and every tool esign's flake provides is in mise's registry except watchman, an optional Metro accelerator that Homebrew installs.

`.github/actionlint.yaml`: **only add it if actionlint actually complains.** The workflows repo's file exists to silence two `job.workflow_*` false positives that template callers never use. Run `actionlint` in the template first; if clean, add nothing and record that.

`README.md:14`'s Release badge points at `actions/workflows/release.yml`, which does not exist — point it at `release-internal.yml`.

Verify: `make check`, `pnpm test`, `pnpm exec lefthook run pre-commit --all-files`.

## PR 3 — Docs-only classification becomes the single source (both repos, one change)

**Workflows repo.** `scripts/ci/changed-class.sh`: `^LICENSE$` → `(^|/)LICENSE$` (kyc's per-package LICENSE lesson); add an all-zero-sha guard (first push of a branch → `docs-only=false`, exit 0) and an unreachable-base guard (`git cat-file -e "$base^{commit}"` failing → notice + `false`, exit 0) so a force-push or shallow clone fails open instead of aborting the step under `set -euo pipefail`. `checks.yml` classify step:

```yaml
BASE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}
```

The `&&` slot is non-empty, so the family's own documented expression pitfall does not apply.

**Template.** Delete `paths-ignore` from `ci.yml`'s push trigger.

**These must land together** (byte-identity is enforced by `test/consumer-contract.bats`): template `ci.yml`, `test/fixtures/consumer-min/.github/workflows/ci.yml`, the first ```yaml block in `docs/consumer-guide.md`, the guide's `paths-ignore` rationale prose and its `docs-globs` row, `README.md:41`, and `docs/ci.md`'s `ci.yml` trigger cell.

**Tests.** `test/changed-class.bats` gains: per-package LICENSE is docs; all-zero base → false/exit 0; unreachable base → false/exit 0 with a notice; a push-shaped range of only `docs/` → true. `consumer-contract.bats` **did** need an edit: it compared the guide against the fixture only, never against the consumer, so a consumer keeping `paths-ignore` passed. Corrected during execution (PR 3 fix round) with a `require_consumer` case; the original claim here was wrong.

## PR 4 — Audit policy

`checks.yml` gains `audit-soft-on-pr` (bool, default true). The Audit step gains `timeout-minutes: 5`, `continue-on-error: ${{ inputs.audit-soft-on-pr && github.event_name == 'pull_request' }}` and a **step-level** `NPM_CONFIG_FETCH_TIMEOUT: '270000'`. Step-level matters: esign `aebdd28` shows a workflow-level fetch timeout overriding the step budget and turning main red at 61s. `scripts/checks/audit.sh` is unchanged.

Template: split the single comment above `pnpm-workspace.yaml`'s `auditConfig.ignoreGhsas` into one reasoned comment per GHSA (advisory, the path that pulls it in, why it is unreachable from app code, the re-evaluation trigger). Document in `docs/quality.md` that an ignore without a per-entry reason is not mergeable.

Tests: consumer-guide row for the new input; `test/workflow-shape.bats` asserts the Audit step keeps its timeout, its `continue-on-error` expression and the **step-level** fetch timeout (guarding the exact regression esign hit).

## PR 5 — Docs checks in the template

**Structural manifest heuristic.** New `scripts/manifest-structural.mjs` (pure function + CLI guard, `check-licenses.mjs` house style): a `package.json` diff counts as architectural only when a non-dependency key changed (`scripts`, `engines`, `packageManager`, `expo.install.exclude`), not on a version or dependency bump. Wire into `scripts/check-docs.sh`'s warn heuristic, plus a dependabot exemption keyed on `PR_AUTHOR`. Tests in `scripts/manifest-structural.test.mjs`.

**Table-width check.** New `scripts/check-docs-tables.mjs` porting kyc's `table-lines.mjs`: fail when a Markdown table cell line exceeds **120 visible chars** (links/code/tags stripped, `<br>` segments measured individually, fenced blocks and separator rows ignored), over `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/**/*.md`, excluding `docs/superpowers/**`. kyc's own 72 is tuned for narrow package READMEs and yields 112 violations here; 120 yields 23, in 7 files, which this PR fixes with `<br>` inserts. Tests in `scripts/check-docs-tables.test.mjs`. Add to `make check-docs`.

**Mermaid parse check.** The template keeps GitHub-native fenced ```mermaid blocks (`docs/architecture.md` today) rather than esign/kyc's `.mmd` → SVG pipeline: GitHub renders the fences, so SVG artifacts, an assembler and a regeneration hook would be machinery without a reader. What is missing is validation — a malformed diagram currently ships and renders as an error box. New `scripts/check-diagrams.mjs`: extract every fenced mermaid block from the doc set, feed each to a **pinned** `@mermaid-js/mermaid-cli` (`npx --yes @mermaid-js/mermaid-cli@11.16.0`, the version esign pins) parsing to a temp file, and fail with the file, block line number and the parser's message. Cache-friendly: skip entirely when no doc with a mermaid fence changed, and expose `--all` for CI. Tests cover the extractor (fence detection, nested fences, indented blocks) with node:test; the CLI call itself is stubbed. Add to `make check-docs`, and note in `docs/quality.md` that this is the one gate needing network on a cold npx cache.

**Wire `check-docs` into CI** (this is what makes the above real): add a `docs-check` boolean input to the workflows repo's `checks.yml` running the consumer's `check:docs` script through `scripts/checks/run-script.sh`, with `EVENT_NAME`/`BASE_REF`/`PR_AUTHOR` env; the template adds `"check:docs": "make check-docs"` to `package.json`, mirroring the existing `check:release`. Guide row + consumer-contract table row.

## PR 6 — Silent tests in the template

**Survey first.** Run the suite with the rule on locally and list which tests would fail before committing. Known spies already opt out (`src/lib/logger.test.ts` and four screen suites spy on `console.warn`); the unknown is React `act()` warnings, which jest-expo routes through `console.error` from suites that do not spy.

Extract the guard into `src/test/console.ts` (so the node `plugins` project can use it without RNTL/MSW imports), imported by `src/test/setup.ts`, and add `setupFilesAfterEach` to the **plugins** project in `jest.config.ts` — today only the `app` project has it, so the rule would otherwise be half-applied. Export `allowConsole(method, matcher?)` for deliberate cases; unmatched output still throws. Document in `docs/testing.md` and one AGENTS.md bullet: a console line is usually a missing `await waitFor`, not a logging need.

## PR 7 — One port base (template)

Every port derives from `APP_PORT_BASE` (default `8080`) plus a fixed offset, so a second worktree sets one variable and runs side by side: Metro `+1` = 8081 (unchanged, because Expo's default and the dev-client deep link both assume it), mock API `+2` = 8082 (was 4000), Playwright preview `+3` = 8083 (was 8089).

Preferred mechanism: define them in `.mise.toml`'s `[env]` with mise's template syntax, so every shell in the worktree and every `make` target sees the same values with nothing to source. The implementer verifies templating works on the pinned mise (2026.9.x) and falls back to a tiny `scripts/ports.mjs` + `eval $(node scripts/ports.mjs --sh)` in the Makefile if it does not.

Consumers to rewrite: `playwright.config.ts` (both `webServer` entries and `baseURL`), `mocks/server.ts` (already honours `MOCK_API_PORT`), `scripts/e2e/wait-for-mock-api.sh`, `scripts/e2e/maestro-{ios,android}.sh` (the two `adb reverse` lines and `METRO_PORT`), `.maestro/flows/00-launch.yaml`'s `http://.*:8081` assertion, the `Makefile` run targets, and `.env.example` / `.env.development` — the last of these bakes `EXPO_PUBLIC_API_URL` into the bundle, so the run targets export it from the computed port and the dotenv value stays as the bare-`expo start` default.

Guard, ported from kyc's `ports.test.mjs`: a node:test that greps the tracked tree for a bare `8081`/`8082`/`8083`/`4000` literal outside the helper and the dotenv defaults, and fails naming the file — this is what stops the next port from being hardcoded again. Document in `docs/local-dev.md` (run two worktrees with `APP_PORT_BASE=8090`) and one AGENTS.md bullet.

Workflows repo: `scripts/e2e/*` already take `RNW_MOCK_API_PORT` and a Metro port; confirm the caller passes the derived values rather than defaults, and add the base to the consumer guide's env table if it crosses the boundary.

## PR 8 — 100% coverage (template)

Raise `jest.config.ts` to `global: { lines: 100, branches: 100, functions: 100, statements: 100 }` and delete the four per-zone entries, which become redundant. Current measured state is 98.45% lines / 96.26% branches, so this is a gap-filling pass, not a rewrite.

Everything genuinely untestable moves to an explicit `coveragePathIgnorePatterns` entry **with a one-line reason each** — expected: generated GraphQL output, compiled Lingui catalogs, native module bridge files whose behaviour lives in Swift/Kotlin, and `index.ts` barrels. Anything else gets a test.

Port kyc's `coverage-empty.mjs` as `scripts/check-coverage-empty.mjs`: fail when a file appears in the report with zero statements to cover, since a type-only module or barrel silently lifts the percentage while testing nothing. Wire into `make coverage` after the jest run, with node:test for the pure parser over a fixture `coverage-summary.json`. That requires adding `json-summary` to jest's `coverageReporters`.

Sequence inside the PR: flip the thresholds, run `make coverage`, work the failures down, then add the empty-row check last so it does not mask the gap while closing it. Update `docs/testing.md` and the AGENTS.md coverage sentence.

## PR 9 — CodeQL (both repos)

Advanced setup rather than GitHub's Default setup, because the query suite, the config and the suppression mechanism then live in the repo and are reviewable.

**Workflows repo:** new reusable `codeql.yml` (`workflow_call`, inputs `languages` default `javascript-typescript`, `config-file` default `./.github/codeql/codeql-config.yml`, `docs-globs`, plus the family's standard `repository`/`ref`). Two jobs: `changes`, which self-checks-out into `.rnw/` and runs `scripts/ci/changed-class.sh` exactly as `checks.yml` does (a scheduled run has no base, so it classifies as "run everything" — which is the point of the weekly re-scan); and `analyze`, gated on `docs-only != 'true'`, running `github/codeql-action/init@v4` + `analyze@v4` against the consumer checkout. No build step: JS/TS is extracted from source. Permissions stay `contents: read` at the top with the analyze job adding `security-events: write` and `actions: read`, re-declaring `contents: read` per the family's escalation rule. Consumer-guide section + inputs table; `workflow-shape.bats` covers it like every other workflow.

**Template:** thin caller `.github/workflows/codeql.yml` pinned `@v0` — triggers `push: [main]`, `pull_request: [main]`, and `schedule: '17 6 * * 1'`; concurrency `codeql-${{ github.ref }}` with `cancel-in-progress: true` (unlike the release group, an interrupted scan costs nothing). No `paths-ignore`: that is the same second-narrower-rule mistake PR 3 removes. New `.github/codeql/codeql-config.yml` with `queries: security-and-quality` and `packs: codeql/javascript-queries:AlertSuppression.ql`, the pack that makes an inline `// codeql[rule-id]` marker actually suppress one finding — without it the marker is silently ignored, which esign discovered when the same JWT false positive re-opened three times. The config's comment records why a marker beats an API dismissal: a dismissal is keyed to the alert fingerprint and re-opens after any file move, while a marker travels with the code and silences one site rather than the query. Paths excluded: generated GraphQL, compiled Lingui catalogs, `ios/`, `android/`, `dist/`, `coverage/`, `vendor/bundle`, `.rnw/`.

**Local `make codeql`.** kyc's `scripts/codeql-local.sh` sources the CLI from its Nix flake; the template has no Nix, so the resolution order becomes `codeql` on PATH, else the `gh codeql` extension, else a clear message naming both install routes. Everything else ports: read the suite and packs out of the config file so local and CI cannot diverge, build the database with `LGTM_INDEX_FILTERS` excluding the same build output a fresh checkout lacks, write to a gitignored `.codeql/`, and exit non-zero when an unsuppressed finding remains so it works as a pre-push gate. Port `scripts/lib/codeql-findings.mjs`'s `summarize()` plus its CLI, with node:test over a fixture SARIF covering suppressed, unsuppressed and rule-id-less findings.

**Non-blocking by design:** CodeQL is informational and must not be a required check, so a runner hiccup cannot block a merge. That is a repo-settings note for after the push, not code.

## PR 10 — E2E job shaping (workflows repo)

- **Maestro cache** (`.github/actions/maestro/action.yml`): `path:` becomes `~/.maestro` plus `!~/.maestro/tests` and `!~/.maestro/logs`; key gains `-v2`, because `actions/cache` only saves on a key miss and a warm cache would otherwise keep restoring the fat blob. Our scripts already pass `--debug-output`, so this is hygiene against consumer hooks that call `maestro` directly, plus the CLI's own growing `logs/`. Update `docs/cache-keys.md`.
- **Forensics on success**: already correct on both platforms (`if: always()`). Add a structural regression test so a future "save storage" edit cannot reintroduce `failure()`, and a "what it costs" note in `docs/forensics.md` (~50-100 MB per platform per run, 7-day retention; the lever is `retention-days`, not `if:`).
- **Bundle prewarm** (`scripts/e2e/metro-wait.sh`): ask the dev server for the manifest (`curl` with `expo-platform` header and `accept: application/json`) and prewarm `launchAsset.url`'s path+query against the local base, falling back with a `::warning::` to today's hand-built URL. New `test/metro-wait.bats` with a stubbed curl and a manifest fixture. Acceptance evidence is `metro.log`: one `Bundled` line for the prewarm and a first launch served in tens of ms, instead of two multi-second builds.
- **Android SDK retry**: new `scripts/ci/android-sdk-install.sh`, ported from **esign PR 110** (merged 2026-09-15), not from kyc's earlier branch commit — the merged version fixes a real regression in the first cut. It installs the `emulator` package with `ANDROID_SDK_RETRIES` (default 2 → 3 attempts) and purges `$sdk_root/.downloadIntermediates` and `$HOME/.android/cache` between attempts, because the half-written archive is cached and replayed so an unpurged retry fails identically. It runs before `android-emulator-runner`, whose own unretried sdkmanager call then no-ops on an already-current revision — the same property the system-image cache relies on.

  Two details to copy exactly. **`sdkmanager` is not on the runners' PATH**: it ships inside the SDK, so the script searches `cmdline-tools/latest/bin`, then any versioned `cmdline-tools/*/bin`, then the retired `tools/bin`, and fails loudly when it finds none — a missing binary is a broken runner image, not a flaky download, so retrying it just burns the budget and buries the cause. The first cut called a bare `sdkmanager`, which died with "command not found" in milliseconds while the retry loop hid it. And `--install … --channel=0` with stdin closed: the stable channel is what the action asks for, so the revision resolved here is the one it later finds installed, and closing stdin makes an unaccepted licence fail rather than wait on a prompt that never comes; stdout is dropped (progress bars) and stderr kept, since that is where the unreadable archive is reported.

  New `test/android-sdk-install.bats` mirroring PR 110's six cases: resolves the in-SDK binary with PATH stripped to `/usr/bin:/bin`; finds a versioned `cmdline-tools/13.0/bin`; falls back to `ANDROID_SDK_ROOT`; retries twice with the purge then succeeds (3 calls, `.downloadIntermediates` gone, "retry 1 of 2" / "retry 2 of 2" on stderr); gives up at `ANDROID_SDK_RETRIES=1` with "could not install 'emulator' in 2 attempts" and exactly 2 calls; usage error with no args exits 2.
- **Step-level `timeout-minutes`** on the steps that can hang without the job cap being a useful diagnosis: `Pod install` 20, `Build iOS app` 45, `Install Maestro` 10 (both jobs), `Wait for Metro` 10 (both), `Bake AVD snapshot` 20, the new SDK step 15. Leave the Maestro suite steps alone (theirs is derived from `suite-timeout-minutes`) and `download-artifact` (it retries internally). Assert with a named list in bats so a rename cannot silently drop one.

Template side: **no changes** — no `e2e.yml` input is added or renamed, so the caller and the byte-identical fixture are untouched.

---

## PR 11 — Per-branch badges on gh-pages (both repos)

Today's README badges are static workflow-status images with `<owner>/<repo>` placeholders, one of which points at a workflow that does not exist. esign and kyc instead publish real per-branch badges to a `gh-pages` branch: coverage rendered from the measured number, Unit and E2E rendered from the job results, cleaned up when a PR closes.

**Split along the family's existing seam.** SVG rendering needs the `badge-maker` npm package, and the workflows repo has no `package.json`; the template does. So rendering lives in the consumer and publishing lives in the workflows repo, exactly as `run-script.sh` already delegates typecheck and lint back to the consumer.

**Template:** new `scripts/badges/badge.mjs` (pure: `colorFor(pct)` thresholds, `formatPercent`, the `STATUS_RESULTS` map from GitHub job results to text and colour, with an unknown result an error rather than a silently green badge), plus `coverage-badge.mjs` and `status-badge.mjs` CLIs over it, and node:test for the pure half. Coverage comes from `coverage/coverage-summary.json` — the `json-summary` reporter PR 8 already adds — which is far simpler than kyc's multi-workspace HTML scraping. New `badges:render` package script, the contract the reusable workflow calls. `badge-maker` becomes a devDependency (subject to the usual `minimumReleaseAge`). README badges become `raw.githubusercontent.com/<owner>/<repo>/gh-pages/badges/main/{unit,e2e,coverage}.svg`, and `scripts/init.manifest.json` must list those URLs so `--owners` rewrites them.

**Workflows repo:** new `scripts/ci/gh-pages-lib.sh` (`gh_pages_worktree` creating an orphan branch when gh-pages does not exist yet, and `gh_pages_push` with rebase-retry over five attempts, because branches publish concurrently), `scripts/ci/publish-badges.sh` (copy into `badges/<branch>/`, write a "CI-owned branch, do not edit" README, commit `chore(ci): badges for <branch> @ <sha7>`, skip cleanly when nothing changed) and `scripts/ci/badges-cleanup.sh` (drop a closed PR's directory). New reusable `badges.yml`: inputs for the three job results, the coverage artifact name and the render script; `permissions: contents: write` on that job alone. bats for all three scripts against a throwaway bare remote — this is the one place where a bug silently rewrites a branch, so the push-retry and the orphan-creation paths both need coverage.

**Guards, copied deliberately:** run under `always()` but skip when any upstream job was cancelled, when the change was docs-only, on release events, and on fork PRs (no token). Only a Unit **failure** writes the red coverage placeholder — a skipped Unit leaves the branch's badge as it was, which is what makes docs-only PRs not blank the badge.

**Coexistence with the web target:** the template already deploys the web export to GitHub Pages via `actions/deploy-pages`. That is a Pages *artifact* deploy, so it does not conflict with a `gh-pages` branch, and the badges are served from `raw.githubusercontent.com` rather than the Pages site. The constraint to document: the repo's Pages source must stay "GitHub Actions" and must not be switched to "deploy from branch gh-pages".

**After pushing:** create the `gh-pages` branch (the script bootstraps an orphan on first run, so this is only needed if a ruleset blocks branch creation), and exempt `gh-pages` from the PR-approval ruleset so the default `GITHUB_TOKEN` can push to it.

## Verification

Per PR, from the affected repo root:

```
# template
make check && pnpm test:scripts && pnpm test
# workflows
make check
RNW_CONSUMER_ROOT=~/Dev/blink/react-native-mobile-template bats test/consumer-contract.bats
```

End to end, after PR 3 and PR 7: one `self-smoke.yml` dispatch with Android on (iOS once) confirming in the run log a Maestro cache miss then hit on the `-v2` key, `Installed: emulator`, a single fast `Bundled` line for the app's first request, both forensics artifacts on a green run, and `docs-only=false` correctly computed on a push.

For PR 7, the acceptance is two worktrees of the template running `make start` and `make mock-api` simultaneously, the second with `APP_PORT_BASE=8090`, both serving their own app. For PR 8, `make coverage` exits 0 at 100% with every ignore entry carrying a reason.

For PR 11, the acceptance is a push to a scratch branch producing `badges/<branch>/{unit,e2e,coverage}.svg` on gh-pages with the right colours, a second concurrent push rebasing rather than failing, and closing a PR removing its directory.

Sequencing: PR 1, 2, 4, 5, 6, 7, 8 are independent. PR 3 must land in the workflows repo first, then the template, because the fixture and guide live in the workflows repo. PR 9 (CodeQL) depends on PR 3, since it reuses the corrected classifier. PR 11 (badges) depends on PR 8, which adds the `json-summary` reporter the coverage badge reads. PR 10's prewarm change lands last within its PR, with the before/after `metro.log` attached; PR 7 (ports) should precede it if both touch the E2E scripts' port handling.

After pushing, three repo-settings steps: leave CodeQL out of the required-checks ruleset (a runner hiccup must not block a merge) and enable Advanced Security at the org level for a private repo; exempt `gh-pages` from the PR-approval ruleset so the default token can push badges; and keep the Pages source on "GitHub Actions" rather than switching it to the gh-pages branch.

## Notes

- Nothing here touches the store-release machinery (fastlane, release-please, OTA) or the app's own source beyond the Jest setup and the port derivation.
- Both repos are local-only, no remotes; all verification is local.
- Deliberately not ported, with reasons: release gate/retry and registry smoke (library publishing; an app deploy is re-runnable, so the complexity is not earned), the `.mmd` → SVG diagram pipeline (GitHub renders the fences natively; the parse check buys the safety without the artifacts or the regeneration hook), the 72-char table width (tuned for narrow package READMEs; 120 measured against this repo's own tables), Nix and direnv (see PR 2), and the multi-workspace fan-out that shapes kyc's coverage and Biome configs (this template is a single package).
