# React Native template family: workflows + mobile template

## Context

Building CI for `blinkbitcoin/esign` (universal RN library) produced a lot of hard-won CI/E2E knowledge that currently lives only in that repo. Meanwhile `blink-mobile` (the store app) has CD in Concourse with version/build-number/signing state scattered across three repos, manual store promotion, and legacy patterns Jonas explicitly does not want replicated.

Goal: a reusable, professional-grade starting point for React Native store apps (mobile first, web optional) so no future app starts CI/CD from scratch, and later a sibling for reusable RN libraries. Must be unconfusing for experienced devs, juniors and coding agents.

## Decisions (locked in during brainstorming, 2026-09-05)

| Topic | Decision |
|---|---|
| Family | Three repos: `react-native-workflows` (neutral home for reusable `workflow_call` workflows + scripts, semver + moving `v1`), `react-native-mobile-template` (flat Expo app, GitHub template), `react-native-library-template` (later, not in this plan) |
| RN base | Expo SDK with prebuild/CNG, no committed ios/android. Native extensions via local Expo Modules + config plugins |
| Package manager | pnpm |
| Dev env | mise pins node/ruby/java (`.mise.toml`, also read by CI) + `doctor` script for Xcode/Android SDK/etc. No Nix |
| Repo shape | Flat single app, no workspaces. Makefile is the command surface (`make help`) |
| Stores | App Store, Google Play, GitHub Releases (signed universal APK + IPA + symbols). Huawei/F-Droid/Samsung: documented lane slot only |
| Release flow (symmetric) | merge to main → TestFlight internal + Play Internal + GH pre-release; tag vX.Y.Z → promote same build to TestFlight external + Play Open + GH release; production → workflow_dispatch behind GitHub Environment with reviewers, phased/staged rollout with adjustable percentage |
| Versioning / changelog | release-please owns version, CHANGELOG.md, tag and GitHub release; merging its release PR is the only human step. No changesets. Build number monotonic and shared across platforms. Injected via app.config.ts from env, never sed |
| Store release notes | Prose for end users: deterministic rendering with optional LLM rewrite (Anthropic or OpenAI-compatible via env), attached once to the release, human-overridable in the release body. Changelog stays GitHub-only unless `STORE_NOTES_INCLUDE_CHANGELOG=true` |
| Signing | iOS: fastlane match (git), readonly in CI, ephemeral keychain, ASC API key. Android: upload keystore secret + Play App Signing, no creds in gradle files |
| Crash reporting | None shipped; documented slot |
| OTA | expo-updates, self-hosted server, channels internal/beta/production, fingerprint runtimeVersion |
| Web | Opt-in target, static export, deploy to GitHub Pages on tag |
| E2E | Maestro (mobile), Playwright (web) |
| App scaffold | Lean but complete: Expo Router (stack+tabs), theming, typesafe i18n, Apollo Client + codegen with hello-world schema, secure storage, env validation, error boundary, one local Expo Module + one config plugin example, "all the linters" fail-fast tooling esign-style |
| Location | Scaffold locally as siblings under `~/Dev/blink/`, git init, no remote. Jonas creates the GitHub repos later |
| Not a reference | blink-mobile implementation is NOT to be copied; only its native-capability needs matter |

## Verified versions (2026-09-05)

Expo SDK 57 (latest, RN 0.86.3, Node 24 LTS, Xcode ≥ 26.4), pnpm 12.3, Maestro CLI 2.10.0 (needs Java 17+, has `--flatten-debug-output`), actions/checkout v7, actions/cache v6, upload/download-artifact v7/v8, ReactiveCircus/android-emulator-runner v2.38, jdx/mise-action v4.3, ruby/setup-ruby v1, gradle/actions v6, configure/upload/deploy-pages v6/v5/v5, release-please-action v5, shellcheck 0.11, actionlint 1.7.12. Reusable workflows: 10 nesting levels, `secrets: inherit` only one level, caller `env` does not propagate, called `permissions` may only reduce. `job.workflow_repository` / `job.workflow_sha` let a reusable workflow check out its own repo at the calling ref.

## Part A: `react-native-workflows` repo

### Tree

```
.github/workflows/   checks.yml unit.yml e2e.yml web.yml release-mobile.yml pr-closed.yml pr-title.yml
                     self-ci.yml self-smoke.yml self-release.yml
.github/actions/     setup/ native-key/ maestro/ forensics/ free-disk/   (composite, local-path)
scripts/lib/         common.sh versions.sh expo-config.sh
scripts/ci/          changed-class.sh free-disk.sh enable-kvm.sh native-hash.sh cancel-runs.sh lint-ci.sh artifact-summary.sh tool-version.sh
scripts/checks/      typecheck.sh lint.sh format.sh i18n.sh codegen.sh expo-doctor.sh audit.sh commitlint.sh
scripts/native/      prebuild.sh pods.sh ios-build.sh ios-pack.sh android-build.sh
scripts/e2e/         metro-start.sh metro-wait.sh ios-simulator.sh android-emulator.sh app-launch.sh maestro-bound.sh ios-maestro.sh android-maestro.sh collect-forensics.sh
scripts/web/         export.sh playwright-version.sh playwright.sh
scripts/release/     fastlane.sh decode-secrets.sh
scripts/self/        tag-major.sh check-versions.sh
test/                bats tests + fixtures
docs/                consumer-guide.md cache-keys.md forensics.md runners.md
.mise.toml .shellcheckrc release-please-config.json .release-please-manifest.json CHANGELOG.md README.md
```

### Core mechanism: self-checkout

Inside a reusable workflow `github.*` is the caller's, so every job does: (1) checkout consumer, (2) checkout `${{ job.workflow_repository }}@${{ job.workflow_sha }}` into `.rnw/` with `persist-credentials: false`, (3) `uses: ./.rnw/.github/actions/setup`. `setup` exports `RNW=$GITHUB_WORKSPACE/.rnw`, adds `.rnw/` to `.git/info/exclude`, runs mise-action (node/pnpm/java from consumer `.mise.toml`), pnpm store cache, `pnpm install --frozen-lockfile`. All `run:` steps are `bash "$RNW/scripts/..."`. Consumers never reference scripts directly.

### Common inputs (every workflow)
`repository`, `ref` (for self-smoke), `working-directory` (`.`), `linux-runner` (`ubuntu-latest`), `macos-runner` (`macos-latest`), `native-cache-version` (`v1`). All workflows: `permissions: contents: read` at top, extra per job; never set `concurrency` (caller owns it).

### Workflows

- **checks.yml** — inputs (bool toggles): typecheck, lint, format, i18n (off), graphql-codegen (off), expo-doctor, audit (+`audit-level`), commitlint (PR title; `commitlint-commits` off), actionlint, shellcheck, docs-only-detection (+`docs-globs`). Output `docs-only`. Jobs: `changes` (fetch-depth 0, `changed-class.sh`), `code` (one step per toggle calling consumer package.json script contract: `typecheck`, `lint`, `format:check`, `i18n:check`, `codegen:check`; codegen = run then `git diff --exit-code`; audit = `pnpm audit --audit-level --prod`), `commits` (PR title via env var, never interpolated).
- **unit.yml** — inputs `coverage`, `test-script`. Runs jest `--ci --coverage`, uploads `coverage/` 30d.
- **e2e.yml** — inputs: `ios` (false, 10x billing), `android` (true), `xcode`, `android-api-level` (35), `maestro-version` (2.10.0, enforced equal to versions.sh), `maestro-flows` (`.maestro`), include/exclude tags, `suite-timeout-minutes` (10), `dev-client` (false), `e2e-setup-script`/`e2e-teardown-script` (consumer file paths), artifact names. Jobs:
  - `build-ios` (macOS): native-key → restore `.app` cache (exact key) → on miss: setup + ruby/setup-ruby (mise Ruby compiles from source on macOS) → `prebuild.sh ios` (`--clean --no-install`) → Pods cache keyed on native hash (Podfile.lock does not exist before pod install) → `pods.sh` → `ios-build.sh` (generic simulator destination, `CODE_SIGNING_ALLOWED=NO`, xcbeautify) → explicit cache save → always `ios-pack.sh` tar → upload 1d.
  - `ios` (macOS): `ios-simulator.sh pick` first (boot overlaps), setup (Java needed for Maestro on macOS too), maestro action (cached `~/.maestro`), metro-start bg, setup-script, wait sim, install tar, `metro-wait.sh` prewarming Expo's `/.expo/.virtual-metro-entry.bundle?platform=ios...`, record start, `app-launch.sh` once per run (dev-client deep link or plain; flows use `stopApp: false`), `ios-maestro.sh` with `MAESTRO_DRIVER_STARTUP_TIMEOUT=600000` inside `maestro-bound.sh` (exit 124 = no retry), one suite retry; always: record stop, teardown, `collect-forensics.sh`, forensics action (artifact URL + junit totals into step summary).
  - `build-android` (linux): native-key → restore APK → setup + gradle/actions → `prebuild.sh android` → `assembleDebug -PreactNativeArchitectures=x86_64 --build-cache` → save → upload (compression 0).
  - `android` (linux): free-disk first always, setup, maestro, enable-kvm, metro bg, download APK, system-image cache + AVD snapshot cache (`...-hidedialogs`), on miss `android-emulator-runner` with `target: default`, x86_64, cores unset (2), one-line `script:` → `android-emulator.sh snapshot-bake` (bakes `hide_error_dialogs 1`, `anr_show_background 0`), metro-wait, then emulator-runner again with one-line `script: bash $RNW/scripts/e2e/android-maestro.sh` (prepare: install, `adb reverse 8081`, `logcat -G 64M`; record chunks; launch once; bounded maestro with `MAESTRO_DRIVER_STARTUP_TIMEOUT=300000`; forensics grep of `ReactNativeJS|AndroidRuntime|FATAL`). Step timeout = suite+5, job 60.
- **web.yml** — inputs `playwright` (true), `deploy` (false; caller passes `github.ref_type == 'tag'`), `base-url` (project Pages path via `EXPO_PUBLIC_BASE_URL` + `experiments.baseUrl`), `export-script`, `output-dir`. Jobs build (expo export, upload-pages-artifact when deploy) → playwright (cache keyed on playwright version parsed from lockfile, `pnpm run e2e:web` serving `dist`) → deploy (`pages: write`, `id-token: write`, env `github-pages`).
- **release-mobile.yml** — inputs `platform` (ios|android|all), `lane`, `build-number` (default run_number), `version` (default from tag), `xcode`, retention. Secrets all optional (so `secrets: inherit` works): MATCH_PASSWORD, MATCH_GIT_BASIC_AUTHORIZATION, APP_STORE_CONNECT_API_KEY_ID/ISSUER_ID/KEY_P8, ANDROID_KEYSTORE_BASE64/PASSWORD, ANDROID_KEY_ALIAS/PASSWORD, GOOGLE_PLAY_JSON_KEY_BASE64, EXPO_TOKEN. Jobs ios/android: setup + ruby, `decode-secrets.sh` → files in `$RUNNER_TEMP/secrets` exported as `RNW_*_PATH`, prebuild, pods cache, `fastlane.sh <platform> <lane>` with `RNW_BUILD_NUMBER`, `RNW_VERSION`, `RNW_OUTPUT_DIR`; uploads outputs. Lane contract: read `RNW_*` env, write to `RNW_OUTPUT_DIR`, emit build-number/version-code outputs. (Part B refines the lanes and the caller workflows.)
- **pr-closed.yml** (cancel runs for head sha; caller grants `actions: write`), **pr-title.yml** (commitlint title on `edited`).
- **self-ci.yml** (actionlint+shellcheck on itself, bats, `check-versions.sh`, docs-only, PR title lint), **self-smoke.yml** (dispatch/weekly/label: calls `./` workflows against `repository: blinkbitcoin/react-native-mobile-template`), **self-release.yml** (release-please simple, tags vX.Y.Z; on release published `tag-major.sh` force-moves `v1` and `v1.N`).

### Cache keys (`native-key` action → `docs/cache-keys.md`)
`hash` = sha256[:16] of pnpm-lock importers["."] runtime deps + devDeps matching `^(expo|@expo/|react-native|@react-native|@react-native-community|@config-plugins/|patch-package)` as `name@version` (via yq, before install) + hashFiles of `app.config.* app.json plugins/** modules/** patches/** Gemfile.lock .mise.toml google-services.json GoogleService-Info.plist` + `native-extra-globs`.
iOS app `ios-app-{ver}-{os}-{arch}-xcode{x}-{hash}` (exact); APK `android-apk-{ver}-{hash}`; Pods `pods-{os}-{hash}` (+prefix restore); pnpm `pnpm-{os}-{lockhash}`; maestro `maestro-{os}-{version}`; sysimg `sysimg-v1-{api}-default-x86_64`; AVD `avd-v1-{api}-x86_64-default-hidedialogs`; playwright `playwright-{os}-{pwversion}`; gradle/mise managed by their actions.

### Consumer `ci.yml` (mobile template, ~20 lines)
`on: push main (paths-ignore docs), pull_request [opened,synchronize,reopened,labeled], workflow_dispatch`; `permissions: contents: read`; `concurrency: ci-${{ github.ref }}` cancel unless main. Jobs `checks` → `unit` (if not docs-only) → `e2e` (`ios: vars.E2E_IOS == 'true' || label e2e:ios`, `macos-runner: vars.RNW_MACOS_RUNNER || 'macos-latest'`), each `uses: blinkbitcoin/react-native-workflows/.github/workflows/<x>.yml@v1`. Separate small `web.yml`, `pr-closed.yml`, `pr-title.yml`, plus release workflows from Part B.

## Part B: Release layer (fastlane + release workflows + OTA)

### Verified (2026-09-05)
fastlane 2.238. `upload_to_testflight(distribute_only: true)` promotes an existing build to external groups without re-upload. `upload_to_play_store` `track_promote_to` + `rollout` fraction promotes an existing version code; with nothing uploaded and `rollout`+`track` set it hits `update_rollout`; halting via `release_status: halted` has regressed before (issues #21253/#21431) so keep a direct AndroidPublisher fallback. `deliver` `phased_release: true` (7-day), `skip_binary_upload`, `submit_for_review`; Spaceship `AppStoreVersionPhasedRelease#pause/resume/complete`. match `readonly`, `setup_ci` ephemeral keychain. CNG: `expo prebuild --clean --no-install`, `EXPO_NO_GIT_STATUS=1`. expo-updates: `runtimeVersion {policy: fingerprint}`, `requestHeaders["expo-channel-name"]`, `codeSigningCertificate`, `Updates.setUpdateRequestHeadersOverride` (channel surfing); `@expo/fingerprint` with `fingerprint.config.js` `sourceSkips: ExpoConfigVersions`. `expo/custom-expo-updates-server` explicitly not production-grade. xprem (ex expo-open-ota): Go, stateless, S3/R2/GCS/local storage, channels→branches, server-side signing, `eoas publish --branch X --rollout-percentage N`, rollback, MIT. GitHub Environments: required reviewers, tag patterns, env-scoped secrets (private repos need Team plan+). `macos-26` GA, Xcode 26.6 default. `orhun/git-cliff-action@v4`.

### Layout (template repo)
Single root `fastlane/` (ios/ and android/ are regenerated, so nothing lives in them): `Fastfile` (imports), `Appfile`, `Matchfile`, `Pluginfile`, `lanes/{shared,ios,android,future}.rb`, `metadata/ios/en-US/*.txt` + `review_information/`, `metadata/android/en-US/*.txt` + `changelogs/`, `metadata/release-notes-context.md` (LLM context), `screenshots/` (phase 2, dirs only). Root: `Gemfile(.lock)`, `.github/release-please-config.json`, `.release-please-manifest.json`, `CHANGELOG.md` (release-please owned), `fingerprint.config.js`, `.fingerprintignore`, `certs/expo-updates-cert.pem` (public only). `plugins/with-android-release-signing.ts` (signingConfigs.release from gradle props), `plugins/with-android-release-abis.ts` (arm only). `scripts/release/{resolve-version,require-green-run,build-info,verify-ios,verify-android}.sh`, `scripts/release/notes.mjs` (+ `notes.test.mjs`, `llm/{anthropic,openai}.mjs`), `scripts/ota/{export,publish}.sh` (publish.sh is the only place that knows `eoas`).

### Env contract for lanes
`APP_VERSION`, `APP_BUILD_NUMBER`, `RELEASE_NOTES_STORE_FILE`, `IOS_BUNDLE_ID`, `IOS_SCHEME`, `ANDROID_PACKAGE` + credentials. `before_all` asserts presence. `shared.rb`: `api_key` (ASC key from base64), `store_notes(limit)` (4000 TestFlight / 500 Play, word-boundary truncation), `build_info` (parses build-info.json, asserts match).

### Lanes
iOS: `build` (setup_ci → match appstore readonly → assert generated project version/build == env → gym Release app-store, `manageAppVersionAndBuildNumber: false`, symbols), `verify`, `upload_internal` (idempotent via Spaceship build lookup; pilot to internal group, changelog = store notes), `promote_beta` (`distribute_only: true`, external group, beta_app_review_info), `release_production` (deliver skip_binary, metadata_path, release_notes written per locale, submit_for_review, automatic_release, phased_release flag, `run_precheck_before_submit: false`), `phased(action: pause|resume|complete)`, `upload_symbols` (stub slot).
Android: `build` (gradle bundleRelease, arm ABIs, signing props from env, `print_command: false`; then bundletool universal APK from the same AAB), `verify`, `upload_internal` (writes `changelogs/<versionCode>.txt`; idempotent via `google_play_track_version_codes`; internal track, mapping upload), `promote_beta` (internal → beta = Open testing, completed), `release_production` (beta → production with `rollout`, full metadata sync only here), `rollout(percent)` (update_rollout path; 1.0 completes), `halt` (release_status halted with AndroidPublisher fallback). `future.rb`: huawei/samsung/fdroid `UI.user_error!` stubs with doc pointer.

### Changelog, versioning and release notes (minimal human labour; added 2026-09-05 after Jonas's review)
- **release-please** (`googleapis/release-please-action@v5`, `release-type: node` so `package.json` version is bumped, `include-component-in-tag: false`, tags `vX.Y.Z`) runs on every main push. It keeps one "chore(main): release X.Y.Z" PR open with the generated `CHANGELOG.md` section (grouped by conventional type, PR links, breaking-change section). **Merging that PR is the only human action to cut a release**: it creates the tag and the GitHub release with notes. No changesets (esign removed them too), no manual tag, no per-PR files. `.github/release-please-config.json` + `.release-please-manifest.json` in the template; `changelog-sections` tuned (feat → Features, fix → Bug Fixes, perf, native/plugins scopes surfaced, chore/ci/docs hidden).
- **Version resolution** (`scripts/release/resolve-version.sh`): HEAD tagged `vX.Y.Z` → that; else open release-please PR exists → version from its title (`gh pr list --label autorelease: pending`); else last tag with patch+1. Internal builds thus always carry the version that will be released (Apple rejects new builds for an already-released version). git-cliff dropped.
- **Beta trigger**: `release: published` (release-please) instead of raw tag push. The beta workflow first waits for that commit's `release-internal` run to be green (`scripts/release/require-green-run.sh`, esign's `require-green-main.sh` pattern, polls ≤ 45 min, fails on red; `release-retry.yml` re-runs a blocked beta once main is green), then promotes that exact build. It uploads the `-build.N` pre-release assets to the `vX.Y.Z` release and deletes the `-build.N` pre-release for that commit.
- **Store release notes** (`scripts/release/notes.mjs`, Node, zero deps):
  1. Source = release-please notes for the release (GitHub release body); for internal builds with no release yet = conventional commit subjects since last tag.
  2. Deterministic renderer → plain text, links stripped, grouped "New / Improved / Fixed", truncated at word boundaries to 4000 (TestFlight) / 500 (Play).
  3. Optional LLM pass when `RELEASE_NOTES_LLM_PROVIDER` ∈ {`anthropic`, `openai`} and the matching key (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, optional `OPENAI_BASE_URL` for OpenAI-compatible endpoints, `RELEASE_NOTES_LLM_MODEL` override; Anthropic default `claude-sonnet-5`): input = commit list + `fastlane/metadata/release-notes-context.md` (product name, audience, tone, words to avoid, locales) → JSON `{locale: text}` for every locale directory under `fastlane/metadata/{ios,android}`; validated (length limits, no markdown, no commit hashes) else falls back to the deterministic text with a warning. Fetch-based adapter for Anthropic Messages API and OpenAI-compatible chat completions; no SDK. Unit-tested with recorded fixtures; the implementer loads the `claude-api` skill before writing the Anthropic adapter.
  4. Output attached once to the GitHub release as `store-notes.json` and echoed in a `## Store notes` section of the release body. Beta and production lanes read from that asset, so text never drifts between tracks. **Human override**: edit the `## Store notes` section in the release body before promoting; `notes.mjs --from-release` prefers the body section over the asset.
  5. `make release-notes [TAG=vX.Y.Z]` renders locally for preview; `RELEASE_NOTES_LLM_PROVIDER=none` disables.
  6. **Audience split (Jonas, 2026-09-06)**: store notes are prose for end users; the changelog (grouped technical list with PR links) goes to GitHub only (release body + `CHANGELOG.md`). Repo variable `STORE_NOTES_INCLUDE_CHANGELOG` (default `false`) appends the changelog after the prose in the store notes, truncated to store limits, for teams that want it.
- Tag workflow still refuses to promote if release version ≠ build-info version at that SHA.
- Build number = `git rev-list --count --first-parent HEAD + BUILD_NUMBER_OFFSET` (repo var, default 1000): identical on both platforms, derivable from the tagged commit alone, monotonic on main, idempotent on re-run. Needs `fetch-depth: 0`. Trunk-only releases (release-branch variant documented as open question).
- Injection only via `app.config.ts` env reads; `fingerprint.config.js` skips version fields.

### Workflows (template callers, policy) → reusable mechanics in `react-native-workflows`
Reusable (supersedes Part A's single `release-mobile.yml`): `expo-prepare.yml` (version, build number, cliff notes both configs, fingerprints, build-info.json, `release-meta` artifact), `expo-build-ios.yml` (macos-26, `DEVELOPER_DIR` from `vars.XCODE_VERSION`, prebuild, pods cache, `fastlane ios build` + `verify`, artifacts ipa+dSYM), `expo-build-android.yml` (keystore decode, prebuild, `fastlane android build` + `verify`, artifacts aab+universal apk+mapping), `fastlane-lane.yml` (generic: lane, runner, environment, env-json, named artifacts), `github-release.yml` (create/edit/promote with fixed asset list), `expo-ota-publish.yml` (channel, ref, rollout; fingerprint gate; export with sourcemaps as 90d artifact; `eoas publish`; curl smoke of signed manifest), plus Part A's `web.yml` for pages. Reusable jobs declare `environment: ${{ inputs.environment }}`; secrets passed explicitly, never `secrets: inherit`. All release workflows: `concurrency: release-${{ github.ref }}`, `cancel-in-progress: false`.
- **release-internal.yml** (`push: main`, dispatch): prepare → build-ios ∥ build-android → (both green) publish-ios (macOS, Transporter) ∥ publish-android → github-prerelease (`vX.Y.Z-build.N` tag via GitHub App token, assets: ipa, aab, universal apk, dSYM zip, mapping, build-info.json, fingerprints, notes-store.txt, SHA256SUMS) → ota-internal.
- **release-please.yml** (`push: main`): release-please action; outputs `release_created`, `tag_name`. Needs a GitHub App token (`RELEASE_TAGGER_APP_*`) so the release PR and tag pass org rulesets and trigger downstream workflows (GITHUB_TOKEN-created events do not trigger workflows).
- **release-beta.yml** (`release: published`, non-prerelease): resolve (release commit on main, build number, `require-green-run.sh` waits for that commit's release-internal, build-info version == release tag) → promote-ios ∥ promote-android (ubuntu, API only) → github-release (upload the `-build.N` assets + `store-notes.json` to the `vX.Y.Z` release, append `## Store notes`, delete the `-build.N` pre-release) → ota-beta. `release-retry.yml` (`workflow_run` of release-internal completed on main) re-runs a beta run that failed on the green gate.
- **release-production.yml** (`workflow_dispatch`: tag, action release|rollout|halt|resume|complete, play_rollout_percent, ios_phased_release, platforms both|ios|android): resolve → ios (env `production`) ∥ android (env `production`) → github-release (`--latest`, append stage line to body) → ota-production (release only) → web (env `github-pages`, release only).
- **ota-hotfix.yml** (`workflow_dispatch`: channel, ref, rollout): fingerprint gate against build-info of the release on that channel; production behind `production` environment.
- Environments: `internal`, `beta` (secret scoping only), `production` (required reviewers, prevent self-review, tag pattern `v*`), `github-pages`.

### Channel model
One binary is promoted through all tracks, so the binary bakes `expo-channel-name: production`. Internal/beta testers switch channel in the hidden in-app developer menu via `Updates.setUpdateRequestHeadersOverride` (Part C `services/updates.ts` must expose this plus channel/runtimeVersion/updateId display).

### OTA server
xprem self-hosted (Docker, R2/S3 bucket, `PRIVATE_KEY` from `expo-updates codesigning:generate`, per-environment `EOO_TOKEN`), channels internal/beta/production mapped to branches. `OTA_CLI_VERSION` repo var pins `npx eoas@<v>`. Guardrails: fingerprint runtimeVersion + CI gate; code-signing cert mandatory and asserted in verify scripts; production publish 100% in release, 10% default in hotfix; rollback = `eoas rollback` or `rollBackToEmbedded` directive.

### Verification gates (after build, before any upload)
iOS: Info.plist version/build/bundle id; `lipo` arm64 only; distribution cert + app-store profile; `Expo.plist` updates URL/runtimeVersion/channel/cert; Hermes magic, no `localhost:8081`; every `EXPO_PUBLIC_*` present in bundle strings; dSYM UUID matches. Android: bundletool/aapt2 versionCode/versionName/package, not debuggable, minSdk; no x86 libs, arm libs present; apksigner cert SHA-256 == `vars.ANDROID_UPLOAD_CERT_SHA256`; manifest updates meta-data; Hermes bundle; `EXPO_PUBLIC_*`; mapping.txt non-empty, BuildConfig.DEBUG false; APK derived from the exact AAB (sha in build-info).

### Secrets / variables
Vars: `IOS_BUNDLE_ID`, `IOS_SCHEME`, `ANDROID_PACKAGE`, `XCODE_VERSION`, `BUILD_NUMBER_OFFSET`, `TESTFLIGHT_INTERNAL_GROUP`, `TESTFLIGHT_EXTERNAL_GROUP`, `EXPO_UPDATES_URL`, `OTA_CLI_VERSION`, `ANDROID_UPLOAD_CERT_SHA256`, `EXPO_PUBLIC_*`, `PLAY_UPDATE_PRIORITY`, `APP_REVIEW_DEMO_REQUIRED`, `E2E_IOS`, `RNW_MACOS_RUNNER`.
Secrets: `MATCH_PASSWORD`, `MATCH_GIT_BASIC_AUTHORIZATION` (or GitHub App token), `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64`, `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON`, `APP_REVIEW_CONTACT_*`, `APP_REVIEW_DEMO_*`, `OTA_PUBLISH_TOKEN` (per env), `RELEASE_TAGGER_APP_ID` + `RELEASE_TAGGER_APP_PRIVATE_KEY` (tag creation despite rulesets). Each documented with "how to obtain" in `docs/release-runbook.md`.

### Runbook (6 steps, in docs/release-runbook.md)
Merge PRs → watch internal summary, smoke on TestFlight internal / Play internal. Merge the open "release X.Y.Z" PR (optionally edit `## Store notes` on the created release first) → beta promotion + assets on the GH release. Soak. Dispatch "Release production" (reviewer approves) → phased/staged 10%, GH latest, web deploy, OTA production. Ramp via `action=rollout`. Close via `complete`. Hotfix: JS-only → ota-hotfix; native → new version. Rollback/halt matrix per platform documented.

### Open items (Part B)
Release-branch numbering variant if hotfix branches are needed; xprem `eoas` non-interactive flags to confirm at setup (fallback: reference server + channel path, ~1 week); Play halt regression check on 2.238; Beta App Review `whatsNew` localisation; Transporter needs macOS (publish-ios could fold into build-ios to save minutes); org ruleset bypass for CI-created `v*-build.*` tags; sideload APK is upload-key-signed and will not upgrade over Play installs; environment reviewers need Team plan on private repos.

### OTA toggle (per Jonas 2026-09-05)
`app.config.ts` reads `OTA_ENABLED` (default `false` in the template): when off, `updates.enabled = false`, no `updates.url`, the ota-* jobs are skipped via `vars.OTA_ENABLED != 'true'`, and the dev menu hides channel controls. When on, everything in Part B applies. `docs/ota.md` covers: enabling (3 steps: generate signing keys, deploy server, set 3 vars/secrets), a ready `deploy/ota/docker-compose.yml` for xprem with R2/S3 or local storage and a `.env.example`, and the fallback to the reference server.

## Cross-slice reconciliation (decisions I made)
1. Reusable release mechanics use Part B's split (prepare / build-ios / build-android / fastlane-lane / github-release / ota-publish / web), not Part A's single `release-mobile.yml`.
2. Build number = first-parent commit count + offset (Part B), not `github.run_number`.
3. macOS runner default `macos-26`, Xcode via `vars.XCODE_VERSION` (resolves Part A open item).
4. Secret names follow Part B (`ASC_KEY_ID`, `ANDROID_UPLOAD_*`, `PLAY_SERVICE_ACCOUNT_JSON`).
5. OTA channels are `internal` / `beta` / `production` (Part B) everywhere; Part C's `APP_VARIANT` keeps only `development` (local dev client, `.dev` bundle suffix) and `production` (CI release builds). No `preview` variant.
6. Part C's `services/updates.ts` adds the hidden developer menu with channel override and update metadata.
7. Part C gains `plugins/with-android-release-signing.ts` and `with-android-release-abis.ts` next to `with-build-stamp.ts`.
8. Local E2E: template ships thin `scripts/e2e/maestro-{ios,android}.sh` for laptops (app already built and running); CI uses the workflows repo's hardened scripts. Small deliberate duplication.
9. Web deploy runs in the production dispatch (gated), not on the tag push, so the site tracks what is actually live in stores.
10. `.rnw/` (self-checkout dir) added to the template's Biome/ESLint/tsconfig/knip/typos ignore lists.

## Part C: `react-native-mobile-template` scaffold, dev env, quality, docs

### Pinned versions
expo ~57.0.20 / RN 0.86.3 / React 19.2.3 / expo-router ~57 / expo-updates 57 / expo-secure-store 57 / jest-expo 57 / TS ~6.0 (TS 7 blocked by typescript-eslint peer) / @apollo/client ^4.2 / graphql-codegen cli ^7.4 + client-preset ^6.1 / Lingui ^6.6 (ESM-only, metro transformer) / Biome ^2.5 / eslint ^10 + eslint-config-expo ^57 (react-hooks v7 = compiler rules) / knip ^6 / lefthook ^2 / zod ^4 / RNTL 14 / msw ^2 / commitlint ^21 / playwright ^1.63 (web only) / mise: node 24, ruby 3.3, java temurin-17, plus actionlint, shellcheck, typos.

### Tree (key parts)
```
.github/            CODEOWNERS PULL_REQUEST_TEMPLATE.md ISSUE_TEMPLATE/ dependabot.yml release.yml workflows/ (thin callers, Parts A+B)
.maestro/           config.yaml flows/{00-launch,home,details,settings,error-screen,deep-link}.yaml helpers/
.vscode/            extensions.json settings.json
assets/             icon, adaptive-icon(+monochrome), splash-icon(+dark), favicon (web), fonts/
docs/               README.md architecture.md local-dev.md quality.md testing.md native-extensions.md ci.md release-runbook.md ota-and-crash-reporting.md decisions/0001..0007 + template.md
e2e/web/            Playwright smoke (web only)
mocks/              schema.graphql resolvers.ts executable-schema.ts server.ts (graphql-yoga :4000) msw.ts README.md
modules/hello-native/   local Expo Module: expo-module.config.json index.ts src/ __tests__/ ios/*.swift+podspec android/*.kt+build.gradle
plugins/            with-build-stamp.ts (+test, tsconfig.json)
public/             web only
scripts/            doctor.mjs doctor.requirements.json init.mjs init.test.mjs check-i18n.sh check-codegen.sh check-licenses.mjs check-lockfile.sh check-bundle-secrets.sh check-prebuild.sh check-docs.sh shellcheck.sh e2e/ assets/generate-icons.mjs
src/app/            Expo Router routes only: _layout.tsx +not-found.tsx +native-intent.tsx +html.tsx(web) (tabs)/{_layout,index,settings}.tsx details/[id].tsx
src/features/       home/ details/ settings/ (screens + tests + .graphql operations)
src/components/     dumb themed UI + ErrorFallback
src/theme/          tokens.ts ThemeProvider.tsx useTheme.ts createStyles.ts
src/i18n/           i18n.ts I18nProvider.tsx locales/{en,es}/messages.po
src/graphql/        client.ts links/{auth,error}.ts cache.ts ApolloProvider.tsx generated/ (never edit)
src/config/         env.ts (zod over EXPO_PUBLIC_*) constants.ts
src/lib/            secure-store.ts storage.ts logger.ts errors.ts crash-reporting.ts (noop adapter)
src/services/       auth.ts updates.ts
src/test/           setup.ts render.tsx mocks/
app.config.ts babel.config.js metro.config.js biome.json eslint.config.mjs commitlint.config.mjs lefthook.yml knip.json codegen.ts lingui.config.ts jest.config.ts playwright.config.ts(web) typos.toml tsconfig.json .mise.toml .npmrc pnpm-workspace.yaml (pnpm settings only) .env.example .env.development .env.production .editorconfig .gitattributes
AGENTS.md CLAUDE.md(=@AGENTS.md) CONTRIBUTING.md README.md SECURITY.md LICENSE Makefile
```
`ios/` and `android/` gitignored (CNG); `expo-build-properties` carries native build settings.

### Command surface
package.json scripts: start (dev-client), ios, android, web, prebuild, doctor, typecheck, lint (biome + eslint), lint:fix, format(:check), knip, spell, deps:check (expo install --check + expo-doctor), deps:audit (pnpm audit + check-lockfile), deps:licenses, i18n:extract, i18n:check, codegen, codegen:check, test, test:coverage, test:e2e:{ios,android,web}, mock-api, check-bundle-secrets, check-prebuild, prepare (lefthook).
Makefile (`make help` default): init, doctor, install, start/ios/android/web, mock-api, typecheck/lint/format/format-check/knip/spell, check-code, check-deps, check-gen, check-ci (actionlint+shellcheck), check-docs, check (all non-test gates), unit/coverage/test, e2e-ios/android/web, codegen/i18n, prebuild, check-prebuild, bundle-secrets-check, clean/reset, help.

### Tooling ownership (zero overlapping rules)
Biome = formatting, import sorting, generic lint, react domain rules, noConsole (except `src/lib/logger.ts`), noRestrictedImports (secure-store only via lib wrapper; `app/` routes may not import graphql/features logic). ESLint = `eslint-config-expo/flat` React/Expo semantic rules only (react-hooks v7 compiler rules, expo env-var rules), stylistic/import-order rules turned off. tsc strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax`. knip `--strict`. pnpm: `minimumReleaseAge` 3 days, `onlyBuiltDependencies`, `strictDepBuilds`, `packageManager` + `only-allow pnpm`. commitlint scope enum: app, ui, i18n, graphql, native, plugins, config, tooling, ci, release, deps, deps-dev, docs, e2e, web. lefthook: pre-commit biome+eslint+typos on staged; commit-msg commitlint; pre-push typecheck+knip+jest changedSince; post-merge install on lockfile change. typos via mise. Licenses allowlist script. Coverage: 80% global, 100% on config/lib/modules index/plugins.

### App architecture choices (ADRs)
- 0001 CNG, no native dirs. 0002 Biome + minimal ESLint. 0003 theming = plain StyleSheet + typed tokens + `createStyles` hook (Unistyles documented as upgrade path; NativeWind not recommended). 0004 Lingui macros + .po via metro transformer (i18next typed resources and typesafe-i18n rejected). 0005 Apollo 4 with `ApolloLink.from([error, retry, auth, http])`, cache persisted to `expo-sqlite/kv-store`, operations in `.graphql` files, client-preset TypedDocumentNode, no generated hooks; mock API = one executable schema serving graphql-yoga (simulators/Maestro) and MSW (jest/playwright). 0006 web opt-in. 0007 mise not Nix.
- Env: `app.config.ts` reads `APP_VARIANT` (development|preview|production) and `APP_BUILD_NUMBER`; derives name/bundle-id suffix, scheme, updates channel header, `runtimeVersion: { policy: 'fingerprint' }`, associated domains; only `EXPO_PUBLIC_*` reaches JS; `env.ts` zod-validates, fails closed, rewrites localhost to 10.0.2.2 on Android dev.
- Error boundary (react-error-boundary) + global handlers → crash-reporting adapter; dev-only "Trigger error" button covered by Maestro.
- Secure store wrapper: `SecureKey` enum, 2KB guard, web shim that throws unless dev flag.
- OTA client: `services/updates.ts` with `useUpdates`, 1h throttled foreground check, banner; channels development|preview|production; `EXPO_PUBLIC_UPDATES_URL`.

### Native extension examples (prove the path end to end)
- `modules/hello-native`: `hello(name)` sync, `getBuildStamp()` async reading Info.plist `AppBuildStamp` / `BuildConfig.APP_BUILD_STAMP`, `platformName` constant. TS wrapper validates and throws a helpful error in Expo Go/web. Jest automock test (100%), Maestro assertion on Settings `NativeDemoCard`, `.web.tsx` fallback.
- `plugins/with-build-stamp.ts`: `withInfoPlist` (AppBuildStamp + `ITSAppUsesNonExemptEncryption=false`, respects existing), `withGradleProperties` + `withAppBuildGradle` (`buildConfigField` via idempotent `mergeContents`). Unit test invokes mods with stub modResults, asserts idempotency. `scripts/check-prebuild.sh` prebuilds to tmp and greps outputs (CI hook). Maestro asserts the stamp on screen: plugin → native → JS → UI loop closed.
- blink-mobile capability audit: ship secure store, kv store, deep links, device/app info, localization, splash/icons, updates client, reanimated/gesture/screens/safe-area. Document recipes: biometrics (expo-local-authentication), camera/QR, push (expo-notifications, Firebase static-frameworks note), share/clipboard/haptics, permissions, web browser/webview, files, screenshot guard, domain deps.

### `make init` (`scripts/init.mjs`, Node, zero deps, unit-tested, self-deleting)
Prompts: app name, slug, iOS bundle id, Android application id, scheme, include web? (default n), CODEOWNERS team. Validates formats. Rewrites app.config.ts, package.json, README, AGENTS.md/docs tokens, .maestro/config.yaml, commitlint scopes, knip.json, typos.toml, .env files, CODEOWNERS. Web declined → deletes `+html.tsx`, `public/`, `e2e/web/`, playwright config, favicon, `*.web.tsx`, web block in app.config, web deps, web scripts/targets/docs. Always deletes itself, its test, `docs/template-usage.md`, the `init` target. Then `pnpm install`, codegen + i18n no-op check, `make check-code`, commit `chore(app): initialize <slug> from react-native-mobile-template` with hooks enabled. `--dry-run`, `--yes` flags.

### Confusion audit (encoded)
CNG explained first thing; linter ownership matrix; generated dirs marked linguist-generated + drift checks; env errors print a table; `only-allow pnpm`; `make doctor` first; native-module-missing hint; 10.0.2.2 rewrite; routes-only rule enforced by lint; commitlint prints scope enum; AGENTS.md command table kept in sync with Makefile by `check-docs`; init touch list tested; dependabot ignores with reasons.

### Open items (Part C)
Xcode/compileSdk minimums for `doctor.requirements.json`; expo-doctor vs `minimumReleaseAge`; persisted documents on by default or manifest-only; Maestro via mise vs curl installer; React Compiler on by default with Lingui macro ordering.

### Open items (Part A)
Debug+Metro E2E now, embedded-bundle mode later; template visibility for self-smoke (PAT if private); API 35 vs 36 AOSP default image availability. (Resolved: runner `macos-26`; template ships `expo-dev-client`, so `dev-client` defaults true for the template's caller.)

## Implementation phases

Locations: `~/Dev/blink/react-native-mobile-template/` and `~/Dev/blink/react-native-workflows/` (siblings of this empty `app-boilerplate/` dir, which stays untouched). Each is `git init`-ed with `main`, no remote. Conventional commits throughout with a scope enum per repo. Until the workflows repo is on GitHub, the template's caller workflows use a placeholder `uses: blinkbitcoin/react-native-workflows/...@v1`; local validation runs the underlying scripts and `act` is NOT assumed. Every phase ends with `make check` green in the affected repo.

Rule for the whole build: **lint and static checks pass first, esign-style** (`make check-ci` = actionlint + shellcheck; Biome, ESLint, tsc, knip, typos, commitlint; Ruby syntax `ruby -c` on lane files; bats for workflow scripts).

### Phase 1: template scaffold + quality tooling (`react-native-mobile-template`)
1. `pnpm create expo-app` (SDK 57 blank-typescript) → flatten into the tree in Part C; `.mise.toml`, `.npmrc`, `pnpm-workspace.yaml` settings, `packageManager`, `only-allow pnpm`.
2. Quality layer: `biome.json`, `eslint.config.mjs` (expo flat minus Biome-owned rules), `tsconfig.json` strict, `knip.json`, `lefthook.yml`, `commitlint.config.mjs`, `typos.toml`, `.editorconfig`, `.gitattributes`, `scripts/{check-lockfile,check-licenses,check-bundle-secrets,check-prebuild,check-docs,shellcheck}.*`, `scripts/doctor.mjs` + requirements JSON.
3. App: Expo Router `(tabs)` + `details/[id]`, theme tokens + `createStyles`, Lingui (en, es) with metro transformer and babel macro, Apollo 4 client/links/cache + `mocks/` executable schema served by graphql-yoga and MSW, codegen client-preset, `config/env.ts` zod, `lib/{secure-store,storage,logger,errors,crash-reporting}.ts`, `services/{auth,updates}.ts` (dev menu with channel override behind `OTA_ENABLED`), error boundary + dev trigger, splash/icons/font, deep links.
4. Native examples: `modules/hello-native` (Swift + Kotlin), `plugins/with-build-stamp.ts`, `plugins/with-android-release-signing.ts`, `plugins/with-android-release-abis.ts`, each with unit tests; `scripts/check-prebuild.sh`.
5. Tests: jest-expo + RNTL setup, `renderWithProviders`, MSW in node, coverage thresholds; `.maestro/` flows per screen; Playwright smoke (web).
6. Makefile with `##` help; `package.json` scripts table from Part C.
Verify: `make doctor`, `make check`, `make unit` (coverage thresholds), `make check-prebuild` (prebuild both platforms into tmp, grep plugin outputs), `make ios` builds and runs on a simulator with the mock API, Maestro `settings.yaml` passes locally proving module + plugin + UI loop, `make android` on an emulator if one is available (else note it).

### Phase 2: `react-native-workflows` CI/E2E
1. Repo skeleton, `.mise.toml` (shellcheck, actionlint, bats, yq), `scripts/lib/*`, release-please config, `self-ci.yml`.
2. Port esign scripts to Expo + pnpm: `native-hash.sh` (pnpm-lock importers via yq), `maestro-bound.sh` (verbatim), `android-emulator.sh`, `ios-simulator.sh`, `metro-start/wait.sh` (Expo virtual entry), `app-launch.sh`, `collect-forensics.sh`, `free-disk.sh`, `enable-kvm.sh`, `changed-class.sh`, `cancel-runs.sh`, `lint-ci.sh`, checks scripts. Bats tests with fixtures for pure scripts (native-hash, changed-class, tool-version, playwright-version, expo-config).
3. Composite actions `setup`, `native-key`, `maestro`, `forensics`, `free-disk`; workflows `checks.yml`, `unit.yml`, `e2e.yml`, `web.yml`, `pr-closed.yml`, `pr-title.yml`, `self-smoke.yml`, `self-release.yml`; `docs/{consumer-guide,cache-keys,forensics,runners}.md`.
4. Template side: `.github/workflows/{ci,web,pr-closed,pr-title}.yml` thin callers; `.rnw/` ignores; `docs/ci.md`.
Verify: `make check-ci` in both repos (actionlint + shellcheck), `bats test/`, and a local dry run of the E2E script chain on this Mac: `native-hash.sh` on the template lockfile, `ios-simulator.sh pick|wait|install`, `metro-start/wait`, `ios-maestro.sh` against the template's built .app; Android chain if an emulator is available. Full runner-level proof happens after Jonas pushes both repos (documented in the plan's "After push" list).

### Phase 3: release layer
1. Template: `fastlane/` (Fastfile, Appfile, Matchfile, Pluginfile, lanes/*.rb, metadata skeleton, release-notes-context.md), `Gemfile(.lock)`, release-please config + manifest + seeded `CHANGELOG.md`, `scripts/release/notes.mjs` with LLM adapters and fixture tests, `fingerprint.config.js`, `.fingerprintignore`, `certs/` (placeholder cert + generation instructions), `app.config.ts` version/build/updates/OTA toggle, `scripts/release/*`, `scripts/ota/*`, `deploy/ota/docker-compose.yml` + `.env.example`.
2. Workflows repo: `expo-prepare.yml`, `expo-build-ios.yml`, `expo-build-android.yml`, `fastlane-lane.yml`, `github-release.yml`, `expo-ota-publish.yml`, `scripts/release/{fastlane,decode-secrets}.sh`, `scripts/ota/*`.
3. Template callers: `release-please.yml`, `release-internal.yml`, `release-beta.yml`, `release-retry.yml`, `release-production.yml`, `ota-hotfix.yml`; environments documented.
Verify (notes): `node --test scripts/release/notes.test.mjs` covers deterministic rendering, truncation, validation fallback, and both adapters against recorded responses; if `RELEASE_NOTES_LLM_PROVIDER` + key are present in env, run one live generation and include the output in the report.
Verify: `ruby -c` + `bundle exec fastlane lanes` parses; `bundle exec fastlane ios build` / `android build` executed locally against a locally prebuilt project with ad-hoc/debug signing disabled where credentials are absent (gym with `skip_codesigning` / gradle assembleRelease with a throwaway keystore) to produce binaries; `verify-ios.sh` / `verify-android.sh` run against those binaries and pass; `resolve-version.sh` and build-number derivation tested with bats on a fixture repo; upload/promote lanes exercised with fastlane's `--env` dry-run wrappers and stubbed Spaceship/Supply calls in RSpec-free Ruby unit checks (`fastlane/test/*.rb` using `FastlaneCore::Helper.test?`). **If `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64`, `MATCH_PASSWORD`, `MATCH_GIT_URL`, `MATCH_GIT_BASIC_AUTHORIZATION`, `ANDROID_UPLOAD_KEYSTORE_BASE64` (+password/alias), `PLAY_SERVICE_ACCOUNT_JSON`, `IOS_BUNDLE_ID`, `ANDROID_PACKAGE` are present in the environment, additionally run `fastlane ios upload_internal` and `fastlane android upload_internal` once for real** and record the result.

### Phase 4: docs, init, ADRs, agent ergonomics
1. `README.md` (60-second start + "using this template"), `docs/*` per Part C incl. `release-runbook.md` (6 steps, secrets how-to table, rollback matrix), `ota.md`, `native-extensions.md`, ADRs 0001-0007, `AGENTS.md` + `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `.github/` templates, CODEOWNERS, dependabot, release.yml.
2. `scripts/init.mjs` + `init.test.mjs`; `make init --dry-run` output; `docs/template-usage.md`.
3. Workflows repo `README.md` + consumer guide finalised; `CHANGELOG.md` seeded.
Verify: `node --test scripts/init.test.mjs`; run `make init --yes` in a scratch copy with web declined and confirm `make check` + `make unit` green and `knip` finds no web stragglers; `make check-docs`; a fresh-clone walkthrough of README's 60-second start on this Mac.

### After Jonas pushes both repos (not in this pass, listed for completeness)
Create `blinkbitcoin/react-native-workflows` and tag `v1.0.0` + `v1`; mark the template repo as a GitHub template; set repo vars/secrets from the runbook table; create environments `internal`, `beta`, `production` (reviewers), `github-pages`; run `self-smoke.yml`; first `release-internal` run on a test bundle id.

## Verification summary (end to end for this pass)
- Both repos: `make check` (all static gates) and `make check-ci` green; bats/jest/node:test suites green with thresholds.
- Template runs on iOS simulator against the mock API; Maestro settings flow proves native module + config plugin + UI.
- Prebuild check proves CNG from a clean checkout on both platforms.
- Local E2E script chain from the workflows repo drives the template's .app on a simulator.
- Release binaries built locally pass both verify scripts; version/build-number derivation covered by tests; real store upload only if credentials are supplied via env.
- `make init` produces a green single-app repo with web removed.
