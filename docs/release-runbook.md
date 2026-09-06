# Release runbook

Everything between "a PR is merged" and "users have it". The mechanics live in
[`blinkbitcoin/react-native-workflows`](https://github.com/blinkbitcoin/react-native-workflows);
this repository only ships policy — which workflow runs when, with which inputs.

OTA is documented separately in [ota.md](ota.md).

## The shape of it

```
merge a PR ──► release-internal   TestFlight internal + Play internal
                    │              vX.Y.Z-build.N pre-release, OTA internal
                    ▼
merge the release PR ──► release-please ──► vX.Y.Z release published
                                                  │
                                                  ▼
                                            release-beta   TestFlight external
                                                  │        + Play open beta
                                            (soak)│        + OTA beta
                                                  ▼
                                     release-production (dispatch, reviewed)
                                            App Store + Play + web + OTA
```

One binary is built once, on the merge to main, and then *promoted*. Beta and
production never rebuild — they call store APIs against the build that internal
already produced and that testers already used. That is why
`release-beta.yml` will not promote until that exact commit's `release-internal`
run is green (`require-green-workflow: release-internal.yml`).

## The six steps

### 1. Merge PRs to main

`release-internal.yml` runs on every push: it resolves the version and build
number, builds and signs both platforms, uploads to TestFlight internal and the
Play internal track, creates a `vX.Y.Z-build.N` GitHub pre-release with every
artifact, and (if OTA is on) publishes to the `internal` channel.

Smoke the build on TestFlight internal / Play internal. Nothing further is
automatic.

### 2. Merge the open release PR

release-please keeps one `chore(main): release X.Y.Z` PR open, with the
generated `CHANGELOG.md` section. **Merging it is the only human action that
cuts a release**: it bumps `package.json`, tags `vX.Y.Z` and publishes the
GitHub release.

Optionally edit the release's `## Store notes` section first — see
[Store notes](#store-notes). The section is read at promotion time, not at
release time, so editing it before step 3 finishes is safe.

### 3. Beta promotes itself

`release-beta.yml` fires on `release: published` (non-prerelease), waits for the
release commit's internal run, then promotes to the TestFlight external group
and the Play open beta track, attaches `build-info.json` and the store notes to
the `vX.Y.Z` release, and publishes OTA `beta`.

If beta was published before internal finished, the beta run fails at the gate.
`release-retry.yml` re-runs it automatically the moment internal for that commit
goes green — no manual retry needed.

### 4. Soak

Give beta long enough to surface crashes and store-review problems. There is no
automation here on purpose.

### 5. Dispatch the production release

**Actions → release-production → Run workflow**, `tag: vX.Y.Z`,
`action: release`. A reviewer on the `production` environment has to approve
before any store job starts. It then:

- submits to the App Store (phased release on by default) and rolls out on Play
  at `play_rollout_percent` (default `10`),
- marks the GitHub release `latest`,
- publishes OTA `production` at 100%,
- deploys the web export to GitHub Pages.

`platforms` (`both` / `ios` / `android`) narrows it when one store is behind.

### 6. Ramp, then close

Re-dispatch with `action: rollout` and a higher `play_rollout_percent` to ramp
Play. When you are confident, `action: complete` finishes the iOS phased release
and takes Play to 100%. `action: halt` stops both. See
[Rollback and halt](#rollback-and-halt).

## Versions and build numbers

- **Version** comes from `scripts/release/resolve-version.sh`: a stable `vX.Y.Z`
  tag on HEAD → the open release PR's title → the newest stable tag with its
  patch bumped → `0.0.1`. Prerelease tags are ignored at every step. Internal
  builds therefore already carry the version that will be released.
- **Build number** = `git rev-list --count --first-parent HEAD` plus
  `BUILD_NUMBER_OFFSET` (repo variable, default `1000`). Identical on both
  platforms, derivable from the tagged commit alone, monotonic on main and
  idempotent on a re-run. It needs `fetch-depth: 0`, which the reusable
  workflows set.
- **Raise `BUILD_NUMBER_OFFSET`, never lower it.** App Store Connect and Play
  both reject a build number that goes backwards, permanently.
- **App Store rejects a new build for an already-released version.** Once
  `1.2.3` is live, every further build must be `1.2.4` or later. This is why the
  version is resolved from the pending release PR rather than from the last tag:
  builds on main after a release already carry the *next* version, not the
  released one.

## Store notes

`scripts/release/notes.mjs` renders the notes both stores get. The deterministic
renderer always runs: it strips links, PR references, commit hashes and ticket
keys, groups changes into New / Improved / Fixed and truncates at a word
boundary to 4000 characters (TestFlight, App Store) or 500 (Play). Output is
`store-notes.json` + `notes-store.txt`, attached to the release; the lanes read
those files, so beta and production never disagree about the text.

Preview locally with `make release-notes` (or `make release-notes TAG=vX.Y.Z`).

**Human override.** Add or edit a `## Store notes` section in the GitHub release
body before promoting. Its line structure is kept as written; it still goes
through the same hygiene filter, so a link or a `#123` in it is removed rather
than shipped.

**Audience split.** Store notes are prose for end users; the grouped technical
changelog with PR links stays on GitHub (release body + `CHANGELOG.md`). Set the
repo variable `STORE_NOTES_INCLUDE_CHANGELOG=true` to append the changelog after
the prose, truncated to the store limits.

**Optional LLM pass**, off unless configured. Every failure — no key, an HTTP
error, unparseable JSON, a missing locale, a leaked commit hash — is a warning
and a fall back to the deterministic prose. A release never fails because a
model was unavailable.

| Variable | Meaning |
| --- | --- |
| `RELEASE_NOTES_LLM_PROVIDER` | `anthropic` or `openai`; anything else disables the pass |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | key for the chosen provider |
| `RELEASE_NOTES_LLM_MODEL` | model override |
| `OPENAI_BASE_URL` | OpenAI-compatible endpoint |

## Variables and secrets

Repository **variables** (Settings → Secrets and variables → Actions →
Variables). None are sensitive; all are visible in logs.

| Variable | Used by | Value / how to obtain |
| --- | --- | --- |
| `IOS_BUNDLE_ID` | every build and lane job | Your App Store bundle identifier |
| `IOS_SCHEME` | every build and lane job | Xcode scheme name (the Expo prebuild generates it from the app name) |
| `ANDROID_PACKAGE` | every build and lane job | Play application id |
| `XCODE_VERSION` | `release-internal` iOS build | A version installed on the runner image, e.g. `26.0`; sets `DEVELOPER_DIR` |
| `BUILD_NUMBER_OFFSET` | every `expo-prepare` call | Integer, default `1000`. Raise only |
| `RNW_MACOS_RUNNER` | iOS build + iOS internal upload | Runner label, default `macos-26` |
| `TESTFLIGHT_INTERNAL_GROUP` | `release-internal` iOS upload | Group name in App Store Connect → TestFlight |
| `TESTFLIGHT_EXTERNAL_GROUP` | `release-beta` iOS promote | External group name; must already exist and be approved |
| `PLAY_UPDATE_PRIORITY` | Android upload / production | `0`–`5`, Play in-app update priority |
| `ANDROID_UPLOAD_CERT_SHA256` | `verify-android.sh` | `keytool -list -v -keystore upload.keystore`, the SHA-256 line |
| `OTA_ENABLED` | every `ota-*` job, `app.config.ts` | `true` to turn OTA on; see [ota.md](ota.md) |
| `EXPO_UPDATES_URL` | `app.config.ts` at build time | Public origin of the update server |
| `OTA_CLI_VERSION` | `expo-ota-publish` | Exact `eoas` version; the publish script refuses to run unpinned |
| `STORE_NOTES_INCLUDE_CHANGELOG` | `notes.mjs` | `true` appends the changelog to the store notes |
| `E2E_IOS` | `ci.yml` | `true` runs iOS E2E on every push (macOS runners bill at 10x) |

Repository / environment **secrets**. Scope the store credentials to the
`internal`, `beta` and `production` environments rather than the repository when
you want a reviewer between a token and production.

| Secret | Used by | How to obtain |
| --- | --- | --- |
| `MATCH_PASSWORD` | iOS build | The passphrase you chose when running `fastlane match init` |
| `MATCH_GIT_URL` | iOS build | URL of the private certificates repository |
| `MATCH_GIT_BASIC_AUTHORIZATION` | iOS build | `printf 'user:token' \| base64` for a PAT with read access to that repo |
| `ASC_KEY_ID` | iOS build, every iOS lane | App Store Connect → Users and Access → Integrations → App Store Connect API; the key id |
| `ASC_ISSUER_ID` | iOS build, every iOS lane | Same page, the issuer id (one per team) |
| `ASC_KEY_P8_BASE64` | iOS build, every iOS lane | `base64 -i AuthKey_XXXX.p8`. The `.p8` is downloadable exactly once |
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | Android build | `base64 -i upload.keystore` |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | Android build | Keystore password |
| `ANDROID_UPLOAD_KEY_ALIAS` | Android build | Key alias inside the keystore |
| `ANDROID_UPLOAD_KEY_PASSWORD` | Android build | Password of that key |
| `PLAY_SERVICE_ACCOUNT_JSON` | Android build and every Android lane | Google Cloud → service account → JSON key, then grant it release permissions in Play Console → Users and permissions |
| `RELEASE_TAGGER_APP_ID` | `release-please`, every `github-release` call | A GitHub App installed on the repo with contents + pull-requests write |
| `RELEASE_TAGGER_APP_PRIVATE_KEY` | same | That App's private key (`.pem`, whole file) |
| `OTA_PUBLISH_TOKEN` | every `ota-*` job | One of the update server's `EOO_TOKENS`; scope per environment |

### Why the GitHub App matters

A release created with the default `GITHUB_TOKEN` **does not trigger other
workflows**. Without `RELEASE_TAGGER_APP_ID` / `RELEASE_TAGGER_APP_PRIVATE_KEY`,
release-please's `vX.Y.Z` release publishes but `release-beta.yml` never fires,
and an org ruleset that forbids Actions-authored pushes blocks the release PR
outright. Configure both or neither — the workflows branch on the id being set.

### Known gap: App Store review contact and demo account

`fastlane/lanes/ios.rb` reads `APP_REVIEW_EMAIL`, `APP_REVIEW_PHONE`,
`APP_REVIEW_FIRST_NAME`, `APP_REVIEW_LAST_NAME`, `APP_REVIEW_NOTES`,
`APP_REVIEW_DEMO_USER` and `APP_REVIEW_DEMO_PASSWORD`, but `fastlane-lane.yml`
declares no secret inputs for them and its `env-json` is printed to the log, so
credentials must not go there. Until the reusable workflow grows those secret
slots, set the review contact and demo account **in App Store Connect directly**
and leave the variables unset; the lane treats them as optional.

## GitHub Environments

Settings → Environments. Four, three of which exist only to scope secrets:

| Environment | Protection | Purpose |
| --- | --- | --- |
| `internal` | none | Scopes the signing and store credentials used by `release-internal` |
| `beta` | none | Scopes the credentials used by `release-beta` |
| `production` | **Required reviewers** (at least one, "prevent self-review" on), deployment branches and tags limited to the tag pattern `v*` | Gates every store job in `release-production.yml` and a production OTA hotfix |
| `github-pages` | GitHub creates it | Used by the `web.yml` deploy job |

The `production` reviewer is the release gate: nothing in `release-production.yml`
or a production `ota-hotfix` starts until someone approves. On a private
repository, required reviewers need a Team plan or above.

## Rollback and halt

Dispatch `release-production.yml` with the matching `action`. Nothing here needs
a new build.

| Situation | `action` | iOS effect | Android effect |
| --- | --- | --- | --- |
| Bad release spotted during rollout | `halt` | Phased release paused — no new users get it | Play rollout halted |
| Fixed, want to continue | `resume` | Phased release resumed | Play rollout resumed at `play_rollout_percent` |
| Confident, ship to everyone | `complete` | Phased release completed | Play rollout set to 100% |
| Ramp gradually | `rollout` | (no-op; iOS phasing is Apple's own 7-day schedule) | Play rollout set to `play_rollout_percent` |

What halt does **not** do: it does not remove the app from users who already
updated. Neither store can un-ship a build. A halt buys time; the fix is a new
version, or — for a JS-only problem — an OTA rollback (see
[ota.md](ota.md#rollback)).

`platforms` narrows any of these to one store, which is what you want when only
one platform is bad.

## Hotfix

**JS-only** (no native code, no plugin change, no new dependency with a native
module): use `ota-hotfix.yml`. Full flow in [ota.md](ota.md#hotfix). The
fingerprint gate rejects anything that moved the native layer, and it is right
to — such an update crashes every user on the channel on launch.

**Anything native**: it is a normal release, just a faster one. Land the fix,
let `release-internal` build it, merge the release PR release-please opens,
let beta promote, then dispatch production. The steps do not change; only the
soak does.

## Verification gates

Two scripts stand between a build and a store. Both are run by a fastlane lane
(`fastlane ios verify`, `fastlane android verify`) and both can be run by hand:

```bash
make verify-ios ARTIFACT=artifacts/ios/App.xcarchive ARGS=--no-signing
make verify-android AAB=artifacts/android/app-release.aab APK=artifacts/android/app-universal.apk
```

Each check prints one line — `ok`, `warn`, `skip` or `FAIL`, followed by the
check name and a detail — and the same checklist is appended to
`$GITHUB_STEP_SUMMARY` when CI set it. **Only `FAIL` fails the gate** (exit 1).
`skip` means the check could not run: a tool is missing (`bundletool`, `aapt2`),
or an input was not given (`APP_VERSION` unset, no `--cert-sha256`). That is
deliberate — the gates have to be usable on a laptop that has neither an Android
SDK nor a release environment.

`verify-ios.sh <path> [--no-signing] [--dsym <path>]` takes an `.ipa`, an
`.xcarchive`, or the `.app` inside one, and checks the Info.plist version, build
number and bundle id against `APP_VERSION` / `APP_BUILD_NUMBER` /
`IOS_BUNDLE_ID`; that `lipo` reports arm64 and nothing else; the signature, the
embedded provisioning profile and `get-task-allow` (skipped under
`--no-signing`, which is what a local unsigned archive needs); that
`Expo.plist`'s `EXUpdatesEnabled` agrees with `OTA_ENABLED`, and that an
OTA-enabled build carries an update URL; that `main.jsbundle` is Hermes
bytecode with no Metro dev-server URL in it; and, with `--dsym`, that the dSYM's
UUIDs cover the binary's.

`verify-android.sh <aab> <apk> [--cert-sha256 <fp>]` reads the APK with `aapt2`
and the AAB with `bundletool`, checks both against `APP_VERSION` /
`APP_BUILD_NUMBER` / `ANDROID_PACKAGE` **and against each other** (an APK built
from a different bundle than the one being uploaded is the mistake this exists
to catch), refuses a debuggable build or a `minSdkVersion` below 24, refuses any
`lib/x86*` and requires an arm ABI, verifies the signature with `apksigner`
(compared against `--cert-sha256`, or `ANDROID_UPLOAD_CERT_SHA256` when the flag
is absent), checks the OTA meta-data the same way iOS does, and compares the
APK's SHA-256 with `artifacts.apkSha256` in `build-info.json` when the release
workflow has filled it in.

Both gates check every `EXPO_PUBLIC_*` name in `.env.example`: Expo inlines the
*values*, so for each name that is set and non-empty in the environment at
verify time, that value has to appear in the JS bundle. Names that are unset are
listed as skipped and never fail.

Two things only ever **warn**:

- Store metadata still carrying `Replace this text`. The hard gate is
  `assert_metadata_ready!` in the `release_production` lanes; failing a beta
  build over copy nobody has written yet would help no one.
- `certs/expo-updates-cert.pem` still being the certificate this template ships,
  when OTA is on. Its private key was discarded (see `certs/README.md`), so it
  proves the wiring and not the trust chain.

## Local builds

`make check-release` runs the same lane checks CI runs (Ruby syntax, a fastlane
lane parse, the lane unit tests) and is wired to `pnpm check:release`, which
`ci.yml` turns on via `release-checks: true`. It needs `bundle install` first.

**bundletool.** The `android build` lane derives the universal APK from the
signed `.aab` with bundletool, and no runner image or laptop ships it. CI
installs a pinned jar; locally you have to provide it and point `BUNDLETOOL_JAR`
at it:

```bash
brew install bundletool          # or download the jar from the releases page
BUNDLETOOL_JAR="$(brew --prefix)/libexec/bundletool.jar" bundle exec fastlane android build
```

Without it the lane fails at the APK step, after a successful bundle — the
`.aab` is fine, only the sideloadable APK is missing.

Note that the universal APK is signed with the **upload** key, not Play's app
signing key, so it will not install over a Play-installed copy of the app.

## Future stores

`fastlane/lanes/future.rb` holds deliberate stubs that fail loudly rather than
pretending to work:

| Lane | Store | What implementing it needs |
| --- | --- | --- |
| `upload_huawei` | Huawei AppGallery | An AppGallery Connect client id/secret, the `fastlane-plugin-huawei_appgallery_connect` plugin, and an HMS-free build (no Google Play Services dependency at runtime) |
| `upload_samsung` | Samsung Galaxy Store | Seller Portal API credentials and the Galaxy Store CLI; the same `.aab` works |
| `fdroid_metadata` | F-Droid | Reproducible builds and metadata YAML in `fdroiddata`; F-Droid builds from source, so it needs the release to be buildable without any proprietary dependency |

Each raises `UI.user_error!` pointing back at this section. Add a store by
implementing its lane and adding a job to `release-production.yml` behind the
`platforms` input — nothing else in the path assumes there are only two stores.
