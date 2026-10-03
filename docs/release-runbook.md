# Release runbook

Everything between "a PR is merged" and "users have it". The procedure is not
written here. It is the family's, and it lives with the workflows in
[`blinkbitcoin/shared-workflows`](https://github.com/blinkbitcoin/shared-workflows):
[the release runbook](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/release-runbook.md)
tells the six steps, versions and build numbers, rollback, hotfix and the
verification gates. This page holds only what this app chooses: its callers,
its variables and secrets, its environments and its store listing.

OTA is on its own page, [ota.md](ota.md).

## What this repository ships

Each `.github/workflows/cd-*.yml` is one call into a shared pipeline, with the
trigger, concurrency group, permissions, secrets and inputs this app wants
([decision 0026](decisions/0026-cd-pipelines-from-shared-workflows.md); [ci.md](ci.md)
maps each file to its job). The tiers:

| Caller | Runs when | Reaches |
| --- | --- | --- |
| `cd-internal.yml` | every push to `main` that is not docs only | TestFlight internal, Play internal, the `vX.Y.Z-build.N` pre-release |
| `cd-release.yml` | every push to `main` | keeps the release PR open and drafts its store notes; at a cut release, dispatches beta |
| `cd-beta.yml` | dispatched at a cut release | TestFlight external group, Play open beta |
| `cd-production.yml` | dispatched by hand, behind reviewers | App Store, Play, Huawei AppGallery, OTA production |
| `cd-store-listing.yml` | dispatched by hand | the store listing, outside a release |

Merge the release PR with a squash, and never edit a version by hand
([AGENTS.md](../AGENTS.md)).

## Store notes

The notes are drafted from `store-notes.prompt.md` into the release PR body,
reviewed there, and every tier ships that text. Edit the prompt to change the
draft, or the release body after merging, then preview with `make store-notes`
(`TAG=vX.Y.Z` reads that release's body, `PR=N` that PR's). How the draft is
built, truncated per store and falls back to deterministic prose is in
[the shared runbook](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/release-runbook.md#store-notes).

### Provider recipes

Which model drafts the notes is set by repository variables and one secret:
`STORE_NOTES_LLM_PROVIDER`, `STORE_NOTES_LLM_MODEL`, `STORE_NOTES_LLM_EFFORT`,
`OPENAI_BASE_URL`, then `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. The table of
providers, endpoints, model examples and efforts, and the preview for a local
model, is the shared
[Provider recipes](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/release-runbook.md#provider-recipes).

## Store listing metadata

`fastlane/metadata/**` is the source of truth for the public store page, and
`fastlane/screenshots/<locale>/**` and `fastlane/metadata/android/<locale>/images/**`
are committed with it. `cd-store-listing.yml` pushes or pulls it, gated on
`STORE_METADATA_SYNC_ENABLED`. What this app has to decide:

- **The copy.** The shipped files hold `Replace this text`, and the release
  lanes refuse to run until every one is replaced for your app.
- **Categories.** The template ships no `primary_category.txt`, because a
  guessed category would change a live store page. Create it, with every
  sub-category file the app uses or none, when you want the sync to own them.
- **`app_rating_config.json`** and the category files are outside the
  placeholder gate: review their values yourself.
- **Seeding.** Run `pull_metadata` locally, review the diff, then commit.

How Apple's edit-version constraint, live mode, screenshots, blank fields and
Play's review of listing edits behave is in the shared
[Store listing metadata](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/release-runbook.md#store-listing-metadata).
The `store-metadata` skill walks the files.

## Variables and secrets

Where each value comes from (which console, which page, what it can reach if it
leaks) is in [store-accounts.md](store-accounts.md). The `store-credentials`
skill's `push-to-github.sh --plan` prints `unchanged`, `set` or `missing` for
every name without printing a value. Which job reads each name is in the shared
[Variables and secrets](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/release-runbook.md#variables-and-secrets).
These are the ones this app sets itself. The `cd-*.yml` callers read them and
hand them to the shared pipelines as inputs (`store-uploads-enabled`,
`huawei-uploads-enabled`, `ota-enabled`, `testflight-internal-group` and so on):
a pipeline reads no repository variable itself.

**Identity, always:** `IOS_BUNDLE_ID`, `IOS_SCHEME`, `ANDROID_PACKAGE`. Every
release job sets `APP_VARIANT=production`, so the bundle id and package name
carry no `.dev` suffix and match them.

**Toggles**, each turning on one more tier (all unset is an unsigned build that
needs no store account):

| Variable | Turns on | Needs |
| --- | --- | --- |
| `IOS_SIGNING_ENABLED` | a signed `.ipa` | certificates through `fastlane match` |
| `ANDROID_SIGNING_ENABLED` | an upload-key-signed `.aab` | the upload keystore |
| `STORE_UPLOADS_ENABLED` | TestFlight and Play uploads (implies both signings) | full store accounts |
| `HUAWEI_UPLOADS_ENABLED` | the AppGallery upload, on top of `STORE_UPLOADS_ENABLED` | the Huawei API client |
| `STORE_METADATA_SYNC_ENABLED` | the store listing sync | the same store accounts |
| `OTA_ENABLED` | over-the-air updates, see [ota.md](ota.md) | a signing key and an update server |

**Needed by a CI build**, read and validated by `src/config/env.ts`:
`EXPO_PUBLIC_API_URL` (a URL) and `EXPO_PUBLIC_APP_NAME`. Also
`EXPO_PUBLIC_WEB_DOMAIN` (empty disables the universal-link entries) and
`EXPO_PUBLIC_ALLOW_INSECURE_WEB_STORAGE` (the callers substitute `false` when it
is unset). `E2E_IOS=true` runs iOS E2E on every push to `main`.

**Store groups and tuning:** `TESTFLIGHT_INTERNAL_GROUP`,
`TESTFLIGHT_EXTERNAL_GROUP`, `PLAY_UPDATE_PRIORITY`, `BUILD_NUMBER_OFFSET`
(raise only), `XCODE_VERSION`, and `ANDROID_UPLOAD_CERT_SHA256` (unset, and the
signature check reports `skip`). `PLAY_RELEASE_STATUS` is `draft` for the first
Play upload and unset (meaning `completed`) after it: Play refuses a completed
release on an app that has never been published.

**Secrets**, scoped to the `internal`, `beta` and `production` environments:
`MATCH_PASSWORD`, `MATCH_GIT_URL`, `MATCH_GIT_BASIC_AUTHORIZATION`,
`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64`,
`ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_KEYSTORE_PASSWORD`,
`ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEY_PASSWORD`,
`PLAY_SERVICE_ACCOUNT_JSON`, `HUAWEI_CLIENT_ID`, `HUAWEI_CLIENT_SECRET`,
`OTA_PUBLISH_TOKEN`, the `APP_REVIEW_*` contact (secrets, not variables, so a
reviewer login stays out of logs) and the LLM key above.

Configure in this order: get the unsigned build green, register the store apps,
add the secrets, turn on signing, rehearse with `DRY_RUN=1`, and only then set
`STORE_UPLOADS_ENABLED`. The `store-setup` skill enforces it.

## GitHub Environments

Settings, then Environments:

| Environment | Protection | Purpose |
| --- | --- | --- |
| `internal` | none | Scopes the signing and store credentials used by `cd-internal` |
| `beta` | none | Scopes the credentials used by `cd-beta` |
| `production` | **Required reviewers**, "prevent self-review" on, deployments limited to the tag pattern `v*` | Gates every store job in `cd-production.yml` and a production OTA hotfix |
| `github-pages` | GitHub creates it, allowing `main` only; **add a tag policy `v*`** | Used by the `ci-web.yml` deploy job, which runs at the release tag |

On a private repository, required reviewers need a Team plan or above.

## Rehearsing lanes locally (DRY_RUN=1)

`DRY_RUN=1` makes every store call log its arguments and return canned data, so
a whole promotion walks on a laptop with no credentials. The commands are in
[the shared runbook](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/release-runbook.md#rehearsing-lanes-locally-dry_run1).
Here, both `release_production` lanes and both push lanes of the listing sync
stop on the shipped `Replace this text` placeholder copy, by design. `make
check-release` runs the lane unit tests and needs the gems `make install` puts
in `vendor/bundle`.
