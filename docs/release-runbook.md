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
and the Play open beta track, moves the `vX.Y.Z-build.N` pre-release's assets
onto the `vX.Y.Z` release (and deletes the pre-release and its tag afterwards),
and publishes OTA `beta`.

The assets are **moved, not rebuilt**. A rebuild from the same source is a
different binary with a different signature and a different native fingerprint,
and the OTA gate downstream compares fingerprints — so the release has to carry
the exact bytes internal testers ran. The pre-release is deleted only once the
upload has succeeded, so a failed upload can never leave the binaries nowhere.

Everything in this run is scoped to the tag, not to `main`: `expo-prepare`'s
`release-tag` input makes the tag the checkout ref, resolves `TAG^{commit}` as
the commit that is gated and stamped into `build-info.json`, and takes the store
notes from that release's body. `github.sha` would be the branch tip at the
moment the event fired, which may already be ahead of the tag.

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
the prose, truncated to the store limits. It reaches `notes.mjs` through
`expo-prepare`'s `build-env`.

**Optional LLM pass**, off unless configured. Every failure — no key, an HTTP
error, unparseable JSON, a missing locale, a leaked commit hash — is a warning
and a fall back to the deterministic prose. A release never fails because a
model was unavailable.

| Name | Kind | Meaning |
| --- | --- | --- |
| `RELEASE_NOTES_LLM_PROVIDER` | repo variable | `anthropic` or `openai`; anything else disables the pass |
| `RELEASE_NOTES_LLM_MODEL` | repo variable | Model override |
| `OPENAI_BASE_URL` | repo variable | OpenAI-compatible endpoint |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | **secret** | Key for the chosen provider |

The three variables reach `notes.mjs` through `expo-prepare`'s `build-env`; the
two keys are declared secrets on `expo-prepare.yml`, because `build-env` is a
workflow input and would publish them in the run's parameters.

## Variables and secrets

Repository **variables** (Settings → Secrets and variables → Actions →
Variables). None are sensitive; all are visible in logs.

Most of them reach a runner through the callers' `build-env` input — a flat JSON
object of non-secret environment published to `$GITHUB_ENV` before the prebuild,
the lanes and the consumer scripts run. It is the only channel for arbitrary
environment in this workflow family, and it **refuses** a key that reads as a
credential (anything ending in `_KEY`, `_TOKEN`, `_PASSWORD`, `_PASSPHRASE`,
`_SECRET`, `_CREDENTIAL(S)`): a workflow input is unmasked and readable by
anyone who can see the run. Credentials go in `secrets:` instead.

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
| `ANDROID_UPLOAD_CERT_SHA256` | `android verify` lane → `verify-android.sh --cert-sha256` (via `build-env`) | `keytool -list -v -keystore upload.keystore`, the SHA-256 line. **Leave it unset and the signature check reports `skip`** — the gate that exists to catch a wrong signing identity stops checking |
| `OTA_ENABLED` | `app.config.ts` at build time (via `build-env`) and the `if:` on every `ota-*` job | `true` to turn OTA on; see [ota.md](ota.md) |
| `EXPO_UPDATES_URL` | `app.config.ts` at build time (via `build-env`) and the OTA manifest smoke check | Public origin of the update server |
| `OTA_CLI_VERSION` | `expo-ota-publish` | Exact `eoas` version; the publish script refuses to run unpinned |
| `STORE_NOTES_INCLUDE_CHANGELOG` | `notes.mjs` in `expo-prepare` (via `build-env`) | `true` appends the changelog to the store notes |
| `RELEASE_NOTES_LLM_PROVIDER` | `notes.mjs` (via `build-env`) | `anthropic` or `openai`; anything else disables the optional LLM pass |
| `RELEASE_NOTES_LLM_MODEL` | `notes.mjs` (via `build-env`) | Model override for that provider |
| `OPENAI_BASE_URL` | `notes.mjs` (via `build-env`) | OpenAI-compatible endpoint |
| `EXPO_PUBLIC_API_URL` | the bundle, through `src/config/env.ts` (via `build-env`) | **Required for a CI build**: `env.ts` validates it as a URL and the app fails to start without it |
| `EXPO_PUBLIC_APP_NAME` | same | **Required for a CI build** (non-empty string) |
| `EXPO_PUBLIC_WEB_DOMAIN` | same, plus `app.config.ts` universal links | Your web domain; empty disables the associated-domain / intent-filter entries |
| `EXPO_PUBLIC_ALLOW_INSECURE_WEB_STORAGE` | same | `true`/`false`; the callers substitute `false` when the variable is unset, because `env.ts` rejects an empty string |
| `E2E_IOS` | `ci.yml` | `true` runs iOS E2E on every push (macOS runners bill at 10x) |

`APP_VARIANT` is not a repo variable: the callers hard-code
`"APP_VARIANT":"production"` in `build-env` for every release job. Without it
`app.config.ts` falls back to `development` and appends `.dev` to the bundle id
and package name, which would then disagree with the `IOS_BUNDLE_ID` /
`ANDROID_PACKAGE` the lanes assert.

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
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | `expo-prepare` (`notes.mjs`) | Only needed when `RELEASE_NOTES_LLM_PROVIDER` selects that provider. The notes fall back to deterministic prose without them |
| `APP_REVIEW_EMAIL`, `APP_REVIEW_FIRST_NAME`, `APP_REVIEW_LAST_NAME`, `APP_REVIEW_PHONE` | iOS `promote_beta` and `release_production` lanes | The contact Apple reaches for review questions |
| `APP_REVIEW_DEMO_USER`, `APP_REVIEW_DEMO_PASSWORD` | same | A working login for the reviewer; omit both if the app needs no account |
| `APP_REVIEW_NOTES` | same | Free-text notes for the reviewer |

The seven `APP_REVIEW_*` values are **secrets, not `build-env` or `env-json`
values**: a reviewer demo login is a real credential and both of those inputs are
printed to the log. The lanes omit the whole argument when none of them is set —
`pilot` PATCHes every key it is given, so blanks would erase the contact already
configured in App Store Connect.

### Why the GitHub App matters

A release created with the default `GITHUB_TOKEN` **does not trigger other
workflows**. Without `RELEASE_TAGGER_APP_ID` / `RELEASE_TAGGER_APP_PRIVATE_KEY`,
release-please's `vX.Y.Z` release publishes but `release-beta.yml` never fires,
and an org ruleset that forbids Actions-authored pushes blocks the release PR
outright. Configure both or neither — the workflows branch on the id being set.

### Concurrency: which workflows share a queue

Every **store-affecting** workflow — `release-internal`, `release-beta`,
`release-production`, `ota-hotfix` — shares
`concurrency: release-${{ github.ref }}` with `cancel-in-progress: false`, so two
of them can never touch a store at the same time and none is ever cancelled
half-way.

`release-please` and `release-retry` deliberately have their own groups
(`release-please-*`, `release-retry-*`). GitHub keeps only one *pending* run per
group and evicts the older one, so sharing the store queue would leave the
release PR stale for the length of a 60-90 minute build and drop the run
entirely on two quick pushes — and `release-retry` is precisely the workflow
that has to run promptly. Neither calls a store API.

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
or an input was not given (`APP_VERSION` unset, no `--cert-sha256`). The check
name is printed either way, one line per check, so a row never silently
disappears from the summary.

**`--strict`** turns a skip caused by a *missing tool* into a `FAIL`, so a gate
cannot report success having verified nothing. It is on automatically whenever
`CI=true` or `GITHUB_ACTIONS=true`, which is what makes the laptop default
(skip) and the release-job default (fail) the same flag. Skips for inputs
nobody supplied stay skips in every mode.

`verify-ios.sh <path> [--no-signing] [--dsym <path>]` takes an `.ipa`, an
`.xcarchive`, or the `.app` inside one, and checks the Info.plist version, build
number and bundle id against `APP_VERSION` / `APP_BUILD_NUMBER` /
`IOS_BUNDLE_ID`; that `lipo` reports arm64 and nothing else; the signature, the
embedded provisioning profile and `get-task-allow` (skipped under
`--no-signing`, which is what a local unsigned archive needs); that
`Expo.plist`'s `EXUpdatesEnabled` agrees with `OTA_ENABLED`, and that an
OTA-enabled build carries an update URL; that `main.jsbundle` is Hermes
bytecode and carries no development markers; and, with `--dsym`, that the
dSYM's UUIDs cover the binary's. The `ios verify` lane passes the archive's own
`dSYMs/` directory, so that last check runs in CI without being asked.

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

### What "no dev server" actually checks

The obvious rule — grep the bundle for `localhost:8081` — is wrong twice over,
and both ways are release-blocking:

- `http://localhost:8081/` is the `FALLBACK` constant in React Native's
  `getDevServer.js`. It is in **every** bundle ever built, release included. It
  is inert there (the script URL is a `file://` URL) but the literal is always
  present, so on its own it proves nothing.
- Hermes packs its whole string table into one character buffer with no
  terminators, overlapping shared prefixes and suffixes. `FALLBACK` ends in
  `/`, so whatever string Hermes happens to pack next to it that starts with
  `/` — an asset's `/assets/…` path, say — reads to `grep -a` as one URL that
  exists in no program. Which string lands there is not something a build
  controls.

So the rule depends on the bundle. On **Hermes bytecode** the gate looks only
for complete dev-only literals that adjacency cannot manufacture (`dev=true`,
`hot=true`, `minify=false`, `/.expo/.virtual-metro-entry`,
`index.bundle?platform=`) and reports `ok` otherwise. On a **plain-text**
bundle, where string boundaries are real, any dev-server URL other than the
bare RN fallback is a `FAIL` — though a plain-text bundle in a release artifact
already fails the `hermes` check on its own.

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
