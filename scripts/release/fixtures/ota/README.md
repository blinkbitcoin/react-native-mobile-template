# Real `expo prebuild` output, OTA on

Captured verbatim from

```
OTA_ENABLED=true EXPO_UPDATES_URL=https://updates.example.com/manifest \
APP_VARIANT=production APP_VERSION=1.2.3 APP_BUILD_NUMBER=42 \
  pnpm expo prebuild --platform all --clean --no-install
```

run in a scratch copy of this repository (the same rsync recipe
`scripts/check-prebuild.sh` uses). Nothing here is hand-written, which is the
entire point: the first version of the OTA verification checks was built from
reading `@expo/config-plugins` and asserted a fingerprint *hash* where prebuild
actually writes the `file:fingerprint` sentinel, and the hand-written fixture
encoded the same mistake, so the tests agreed with the bug.

What these files pin:

| File | The thing under test |
| --- | --- |
| `Expo.plist` | `EXUpdatesRuntimeVersion` is `file:fingerprint`, and `EXUpdatesRequestHeaders` is a dict whose `expo-channel-name` is `production` |
| `AndroidManifest.xml` | `expo.modules.updates.EXPO_RUNTIME_VERSION` is `@string/expo_runtime_version`, and the request headers are one **XML-escaped** JSON string (`{&quot;expo-channel-name&quot;:&quot;production&quot;}`) |
| `strings.xml` | that string resource is itself the sentinel, not a hash |

The real hash never appears in any of them: expo-updates writes it at *build*
time into `EXUpdates.bundle/fingerprint` inside the .app and `assets/fingerprint`
inside the APK, and that is what the gates resolve.

The certificate body in `Expo.plist` and `AndroidManifest.xml` is elided (it is
the template's committed public placeholder, `certs/expo-updates-cert.pem`, and
nothing the OTA checks read); everything else is verbatim. Regenerate all three
with the command above when the Expo SDK moves.
