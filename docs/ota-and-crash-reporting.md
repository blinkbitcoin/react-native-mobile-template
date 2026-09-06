# OTA updates and crash reporting

Two separate concerns that share one page because they are the two things
people expect to find wired and find deliberately unwired.

| Concern | State in this template |
| --- | --- |
| Over-the-air updates | Fully implemented, **off by default**. One variable turns it on |
| Crash reporting | A typed adapter with a no-op default. No vendor, no SDK, no account |

## OTA updates

Everything about the toggle, the code-signing keys, the update server, the
channel model, the fingerprint gate, hotfixes and rollbacks is in
**[ota.md](ota.md)**. It is not repeated here.

The short version: `OTA_ENABLED=true` at build time compiles the `updates`
block into the binary (`app.config.ts`), `runtimeVersion` is the native
fingerprint, there is one binary promoted across the `internal`, `beta` and
`production` channels, and `src/services/updates.ts` is the client. Turning it
on after the fact does not retrofit apps already in the field.

The client side is summarized in
[architecture.md](architecture.md#updates-channel-model).

## The crash-reporting slot

`src/lib/crash-reporting.ts` is the whole integration surface:

```ts
export interface CrashReporter {
  captureException(error: unknown, context?: Record<string, unknown>): void;
  setUser(id: string | null): void;
}

export function setCrashReporter(reporter: CrashReporter): void;
export const crashReporting: CrashReporter;
```

`crashReporting` delegates to whatever was last passed to
`setCrashReporter`. The default is a no-op, so the app runs, tests run, and
nothing phones home until you decide otherwise.

Three call sites already report into it:

| Call site | Reports |
| --- | --- |
| `src/components/Providers.tsx` | The `ErrorBoundary`'s `onError`, so every render error is captured |
| `src/app/_layout.tsx` | `ErrorUtils.setGlobalHandler` at module scope, with `{ isFatal }`, chaining to the previous handler |
| `src/graphql/links/error.ts` | Network errors on a GraphQL operation, with the operation name |

Add `setUser` calls in your auth flow when you have a user id worth attaching.

### What to wire, and where

Do it as a side-effect module imported at the top of `src/app/_layout.tsx`,
next to the existing `import '@/services/auth';`. That file's global handler is
installed at module scope, so the reporter must be registered by the time the
module body runs.

```ts
// src/services/crash-reporting.ts (you write this)
import { setCrashReporter } from '@/lib/crash-reporting';
// ... vendor init here ...
setCrashReporter({
  captureException: (error, context) => { /* vendor call */ },
  setUser: (id) => { /* vendor call, id === null means signed out */ },
});
```

```ts
// src/app/_layout.tsx
import '@/services/crash-reporting';
import '@/services/auth';
```

Keep the adapter the only file that imports the vendor SDK. That is what makes
the vendor swappable and keeps the rest of the app testable without a mock for
it.

Two constraints from this repo:

- A DSN or app key that must reach the bundle has to be `EXPO_PUBLIC_*` and be
  added to the zod schema in `src/config/env.ts`. Anything else is stripped and
  `make bundle-secrets-check` fails the build if a non-public key name shows up
  in the exported bundle.
- Adding a native SDK means a config plugin entry in `app.config.ts`, a new
  assertion in `scripts/check-prebuild.sh`, and a fresh dev client. See
  [native-extensions.md](native-extensions.md).

## Recipe: Sentry

**Not wired.** This is the shape of the work, not a tested path. Check the
current API against the package's own documentation.

1. `pnpm expo install @sentry/react-native`.
2. Add the package's Expo config plugin to the `plugins` array in
   `app.config.ts`, with your organization and project.
3. Initialize once, in the adapter module, with the DSN from
   `EXPO_PUBLIC_SENTRY_DSN` (add it to `.env.example`, `.env.development`,
   `.env.production` and the zod schema in `src/config/env.ts`).
4. Implement `CrashReporter` over `Sentry.captureException` and
   `Sentry.setUser`, and pass the `context` argument through as extra data.
5. Tag releases with what the app already knows:
   `constants.version`, `constants.buildNumber` and `constants.buildStamp` from
   `src/config/constants.ts`, plus `Updates.updateId` and `Updates.channel`
   from `src/services/updates.ts` when OTA is on. Without the update id, a
   crash from an OTA build is attributed to the store build's JavaScript.
6. Add an assertion to `scripts/check-prebuild.sh` for whatever the plugin
   writes into the native projects.

### Symbols

This is the part people forget, so here is exactly what exists today.

| Symbol kind | Where it is produced | Uploaded today |
| --- | --- | --- |
| iOS dSYMs | Inside the archive, at `<out>/<scheme>.xcarchive/dSYMs/` | No |
| JavaScript source maps | Not produced or retained by any lane or script in this repo | No |
| Android mapping | Not produced or retained by any lane or script in this repo | No |

The dSYMs are already load-bearing for verification: the `ios verify` lane
passes the archive's own `dSYMs/` directory to
`scripts/release/verify-ios.sh --dsym`, which checks that the dSYM UUIDs cover
the binary's. So a build that verifies has usable symbols on disk.

`fastlane/lanes/ios.rb` has the upload hook already stubbed:

```
fastlane ios upload_symbols            # downloads dSYMs from App Store Connect
fastlane ios upload_symbols dsym_path:/path/to/dSYMs
```

Today it resolves the dSYM path and logs "wire your crash reporter's upload
here". Adding the vendor upload action to that lane is the whole change. Detail
in [release-runbook.md](release-runbook.md).

Source maps need a decision, not just a line of config: something has to keep
the map that matches each shipped bundle, including each OTA publish, or a
stack trace stays minified. Decide where they are produced and stored before
you rely on symbolicated JavaScript frames.

## Recipe: Firebase Crashlytics

**Not wired.** Heavier than Sentry here, for one reason.

1. `pnpm expo install @react-native-firebase/app @react-native-firebase/crashlytics`.
2. Add both config plugins to `app.config.ts` and point them at the
   `google-services.json` and `GoogleService-Info.plist` for your Firebase
   project.
3. **Static frameworks.** The Firebase iOS SDKs are distributed as static
   frameworks, so the iOS build needs `useFrameworks: 'static'`, which means
   installing `expo-build-properties` and setting it there. That switch applies
   to every pod in the project, not just Firebase, and it is a common source of
   build failures in libraries that assume dynamic frameworks. Change it in its
   own commit and run `make check-prebuild` plus a real `make ios` before
   anything else.
4. Implement `CrashReporter` over `crashlytics().recordError` and
   `crashlytics().setUserId`.
5. Android symbol upload runs through the Firebase Gradle plugin, which is
   another prebuild-visible change to assert in
   `scripts/check-prebuild.sh`.

Crashlytics is the right choice when the app is already in the Firebase
ecosystem. Otherwise the static-frameworks tax buys nothing.

## Choosing

| | Sentry | Crashlytics |
| --- | --- | --- |
| Native footprint | One config plugin | Firebase app plus Crashlytics, plus static frameworks on iOS |
| JavaScript stack traces | Good, given source maps | Weaker for the JavaScript layer |
| Cost | Paid past a free tier | Free |
| Fits this template | Yes, adapter plus plugin | Yes, after the `expo-build-properties` change |

Either way, the app-side change is one file: the adapter. That is the point of
the slot.
