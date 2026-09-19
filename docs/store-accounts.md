# Store accounts and credentials

How to get an account on each store, what credentials to create, and which
repository secret or variable each one becomes. For *how a release runs* once
these exist, see [release-runbook.md](release-runbook.md).

Links below are entry points rather than deep links, with the path to follow
inside each console. Consoles get reorganised; the top-level URLs have been
stable for years and the navigation is easier to re-find than a dead anchor.

## First: does this repo need store accounts at all?

Not to start with. There are three tiers, and only the last needs an account.

| Repository variables set | What a push to `main` does | What it needs |
| --- | --- | --- |
| None | Builds both platforms unsigned, runs both verify gates, publishes a GitHub pre-release | Nothing |
| `IOS_SIGNING_ENABLED` / `ANDROID_SIGNING_ENABLED` | Signs and exports a real `.ipa` and `.aab` | Certificates and a keystore |
| `STORE_UPLOADS_ENABLED` | Uploads to TestFlight and Play | Full store accounts |

Uploading implies signing, so the middle tier cannot be skipped by accident.

The unsigned tier is not a stub. It runs prebuild, CocoaPods, Gradle, every
config plugin, the compile and the version stamping, then verifies the output:
a real Android build with no keystore produces a 46 MB `.aab` and a 60 MB
universal `.apk`, and `fastlane android verify` passes sixteen checks against
them. What it cannot prove is signing identity and store delivery.

So: adopt at tier one, move up as credentials arrive.

## Second: a new account, or the one you have?

**Use the organisation account you already have.** Add a new app under it and
create credentials scoped to that app. A second developer account costs money
and time, adds a second set of renewals and a second place to forget a
rotation, and — on Apple — isolates less than you would expect.

The two stores are not equally separable, and that should drive the order you
do things in.

| | Google Play | Apple |
| --- | --- | --- |
| New app under an existing account | Yes | Yes |
| Credential scoped to one app | **Yes** — per-app permissions for a service account | Partial — see below |
| Signing material shared with production | No — each app gets its own upload key | **Yes** — distribution certificates are team-wide |
| Verdict | Genuine isolation, do it | Workable, with one hazard to respect |

### The Apple hazard, stated plainly

`fastlane match` stores signing certificates in a git repository, but the
certificates themselves belong to the **team**, not the app. Two consequences:

- `match nuke` revokes team certificates. Run against this repo's match
  repository, it breaks signing for **every** app on the team, production
  included. Never wire it into a script, a lane or a workflow.
- A separate match repository reduces the blast radius of a leaked repo. It
  does not make the certificates independent.

Use a separate match repository anyway, and treat `nuke` as a command that
only ever gets typed by a human who has said out loud what it will do.

---

## Apple — App Store Connect

**Account:** [developer.apple.com/programs](https://developer.apple.com/programs/)
— Apple Developer Program, about **99 USD per year**. An organisation account
needs a D-U-N-S number and a review that can take days to weeks, so start it
early if you do not already have one. If your organisation already has a
Developer Program account, use it — see the account question above.

**Consoles:** [App Store Connect](https://appstoreconnect.apple.com) for apps,
users and keys. [developer.apple.com/account](https://developer.apple.com/account)
for identifiers, devices and certificates.

### Steps

1. **Register the bundle identifier.** Developer account → Certificates,
   Identifiers & Profiles → Identifiers → **+** → App IDs. This is
   `IOS_BUNDLE_ID`, and it must match `ios.bundleIdentifier` in
   `app.config.ts`.
2. **Create the app record.** App Store Connect → Apps → **+** → New App,
   selecting the identifier from step 1.
3. **Create an App Store Connect API key.** Users and Access → Integrations →
   App Store Connect API. Prefer an **individual key** issued to a user whose
   access is limited to this one app, over a **team key** with App Manager,
   which spans every app on the team. Apple has moved this screen more than
   once — if the wording differs, look for the page that produces a `.p8`
   download, an issuer ID and a key ID.
   The `.p8` downloads **once**; there is no second chance.
   [fastlane's notes on this API](https://docs.fastlane.tools/app-store-connect-api/)
   are the clearest write-up of the three values and how they fit together.
4. **Set up signing.** Run `fastlane match init` against a **new, private** git
   repository, not the one production uses. See
   [docs.fastlane.tools/actions/match](https://docs.fastlane.tools/actions/match/).
   The passphrase you choose becomes `MATCH_PASSWORD`.
5. **Create a TestFlight internal group** for the build to land in, and note
   its exact name for `TESTFLIGHT_INTERNAL_GROUP`.

### What you end up with

| Value | Where it came from | Repo secret or variable |
| --- | --- | --- |
| Key ID | Step 3 | `ASC_KEY_ID` (secret) |
| Issuer ID | Step 3, one per team | `ASC_ISSUER_ID` (secret) |
| The `.p8`, base64-encoded | Step 3 | `ASC_KEY_P8_BASE64` (secret) |
| match passphrase | Step 4 | `MATCH_PASSWORD` (secret) |
| match repo URL and access token | Step 4 | `MATCH_GIT_URL`, `MATCH_GIT_BASIC_AUTHORIZATION` |
| Bundle identifier | Step 1 | `IOS_BUNDLE_ID` (variable) |
| TestFlight group name | Step 5 | `TESTFLIGHT_INTERNAL_GROUP` (variable) |

Base64 the key with `base64 -i AuthKey_XXXX.p8 | tr -d '\n'` and paste the
result. `scripts/release/decode-secrets.sh` turns it back into a file on the
runner.

---

## Google Play

**Account:** [play.google.com/console](https://play.google.com/console) —
**25 USD once**, not annually. Organisation accounts skip the testing
requirements that newer personal accounts face before production access, but
check the current policy rather than taking that on trust.

### Steps

1. **Create the app.** Play Console → All apps → Create app. The application
   id is `ANDROID_PACKAGE`, and it must match `android.package` in
   `app.config.ts`. It can never be changed after the first upload.
2. **Generate an upload keystore**, fresh for this app — do not reuse
   production's:
   ```bash
   keytool -genkeypair -v -keystore upload.keystore -alias upload \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
   Then enrol in [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756),
   which lets Google hold the release key while you hold only the upload key.
   Losing an upload key is recoverable; losing a release key is not.
3. **Create a service account.** [Google Cloud console](https://console.cloud.google.com)
   → IAM & Admin → Service Accounts → Create, then Keys → Add key → JSON.
4. **Grant it access to this app only.** Play Console → Users and permissions →
   Invite new users → paste the service account email → **select this app
   rather than account-wide access**. This step is what makes the credential
   safe to hold in a template repository.
   [Play Developer API getting started](https://developers.google.com/android-publisher/getting_started)
   covers the pairing of the two consoles.

### What you end up with

| Value | Where it came from | Repo secret or variable |
| --- | --- | --- |
| Service account JSON | Step 3, scoped in step 4 | `PLAY_SERVICE_ACCOUNT_JSON` (secret) |
| Upload keystore, base64-encoded | Step 2 | `ANDROID_UPLOAD_KEYSTORE_BASE64` (secret) |
| Keystore password, key alias, key password | Step 2 | `ANDROID_UPLOAD_KEYSTORE_PASSWORD`,<br>`ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEY_PASSWORD` |
| Application id | Step 1 | `ANDROID_PACKAGE` (variable) |
| Upload certificate SHA-256 | `keytool -list -v -keystore upload.keystore` | `ANDROID_UPLOAD_CERT_SHA256` (variable) |

`ANDROID_UPLOAD_CERT_SHA256` is worth setting even though it is optional:
without it `verify-android.sh` reports the signature check as `skip`, and the
gate that exists to catch a wrong signing identity stops checking.

---

## Huawei AppGallery

**Not implemented.** `fastlane/lanes/future.rb` has an `upload_huawei` lane
that fails loudly rather than pretending to work. This section is what
implementing it would need.

**Account:** [Huawei Developer](https://developer.huawei.com/consumer/en/) —
free, but identity verification is required and an organisation account asks
for business documents. Allow days, not hours.

**Console:** [AppGallery Connect](https://developer.huawei.com/consumer/en/service/josp/agc/index.html)
→ My apps.

The credentials are a **client ID and client secret** from AppGallery Connect
(Users and permissions → API key / Connect API), plus the app id from the app
record. The community plugin is
[`fastlane-plugin-huawei_appgallery_connect`](https://github.com/shr3jn/fastlane-plugin-huawei_appgallery_connect).

The real work is not the upload. Huawei devices ship without Google Play
Services, so anything depending on it at runtime — Firebase Cloud Messaging,
Google Maps, Play Integrity — needs a Huawei Mobile Services equivalent or a
graceful fallback. Budget for that, not for the lane.

## Samsung Galaxy Store

**Not implemented**, same as above: `upload_samsung` is a stub.

**Account:** [Samsung Seller Portal](https://seller.samsungapps.com) — free.
A commercial seller account needs business verification.

**Docs:** [Galaxy Store Developer API](https://developer.samsung.com/galaxy-store/galaxy-store-developer-api.html).

Authentication is a service account issued in Seller Portal, exchanged for a
short-lived access token; there is no long-lived API key to paste into a
secret, so the lane has to do a token exchange before it uploads. Samsung
accepts the **same `.aab`** Play does, which makes this the cheapest of the
two additional stores to add — the packaging work is already done.

---

## Rotation, and what to do when something leaks

| Credential | Rotate by | Blast radius if leaked |
| --- | --- | --- |
| `ASC_KEY_P8_BASE64` | Revoke the key in App Store Connect, issue a new one | Every app the key's role can reach — narrow it to one app |
| `MATCH_PASSWORD` | Re-encrypt the match repo with a new passphrase | The certificates in that repo, which are team-wide |
| `PLAY_SERVICE_ACCOUNT_JSON` | Delete the key in Google Cloud, add a new one | Only the apps the account was granted in Play Console |
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | Request an upload key reset in Play Console | Uploads only, if Play App Signing is on. Otherwise the app |

Two things follow from that table. Scope the App Store Connect key to one app,
because it is the one Apple credential whose reach you control. And turn on
Play App Signing, because it is what turns a lost Android key from fatal into
a support ticket.

## Where these values go

Repository settings → Secrets and variables → Actions. Secrets under
**Secrets**, variables under **Variables** — the release workflows read them
from different contexts and a secret placed as a variable is both broken and
public to anyone who can read the run.

The full list, with which workflow reads each, is in
[release-runbook.md](release-runbook.md#variables-and-secrets).

**Store listing sync.** `PLAY_SERVICE_ACCOUNT_JSON` above is also what
`android sync_metadata` / `pull_metadata` use to edit the Play listing, so the
service account needs the **Manage store presence** permission in Play
Console → Users and permissions, not just release access. See
[Store listing metadata](release-runbook.md#store-listing-metadata) for what
those lanes do.
