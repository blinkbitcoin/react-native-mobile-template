---
name: native-setup
description: Use when setting up a machine (laptop or CI runner) to build and test this app on Android or iOS, or when the native toolchain misbehaves - `make doctor` failures, `make dev-android` / `make dev-ios` build errors (missing NDK, code signing on a simulator, adb or pod not found, avdmanager errors), Maestro E2E suites failing wholesale, or Metro not picking up changes.
allowed-tools: Bash(make setup:*), Bash(make setup-toolchain:*), Bash(make setup-android:*), Bash(make setup-ios:*), Bash(make setup-maestro), Bash(make doctor), Bash(adb devices), Bash(adb shell pm clear:*), Bash(xcode-select -p), Bash(xcrun simctl list:*), Bash(security find-identity:*), Bash(.claude/skills/native-setup/tests/run.sh)
---

# Native setup

## Overview

`make setup` takes a blank Mac (or a Linux box, Android only) to one where
`make doctor` passes and `make dev-android`, `make dev-ios`, `make test-e2e-android` and
`make test-e2e-ios` work. Every part is idempotent, so re-running it is also the
first move when the toolchain misbehaves.

**Core principle:** fix the machine through `make setup-*`, never by hand. A
fix typed into one terminal is lost on the next machine; a fix in
`scripts/setup/` is tested (`scripts/setup/setup.test.mjs`) and runs on every
runner. When you find a new pitfall, add it there and to the table below.

## The fast path

```bash
make setup ARGS="--yes"          # everything for this OS; --yes accepts the SDK licences
make setup ARGS="--yes --boot"   # CI: also boot an emulator and a simulator
```

`--yes` (or `SETUP_YES=1`) is an explicit agreement to the Android SDK
licences and to running the remote mise installer. Without it the script asks
in a terminal and refuses anywhere else, so an agent must ask the human before
passing it. The parts, in the order `make setup` runs them:

| Target | Installs |
| --- | --- |
| `make setup-toolchain` | mise, `mise trust` + `mise install` (node, pnpm, java 17, ruby 3.3), watchman, then `make install` |
| `make setup-maestro` | Maestro at the version in `scripts/setup/versions.env`, into `~/.maestro` |
| `make setup-android` | SDK command-line tools, React Native's SDK pins, AGP's fallback packages, the emulator; writes `ANDROID_HOME` to `.env.local` |
| `make setup-ios` | Checks Xcode, installs the iOS simulator runtime and CocoaPods |

`.mise.toml` loads `.env.local` and puts `$ANDROID_HOME/platform-tools`,
`emulator`, `cmdline-tools/latest/bin` and `~/.maestro/bin` on PATH, so
activate mise in the shell (`eval "$(mise activate zsh)"`) or prefix commands
with `mise exec --`.

Things only a human can do (they need an admin password); the scripts stop
and print the exact command: installing Xcode, `sudo xcode-select -s
/Applications/Xcode.app/Contents/Developer`, `sudo xcodebuild
-runFirstLaunch`, `sudo xcodebuild -license accept`.

## Symptom → cause → fix

### Toolchain and `make doctor`

| Symptom | Cause | Fix |
| --- | --- | --- |
| `java: ... Unable to locate a Java Runtime` | `.mise.toml` not trusted, so java is macOS's `/usr/bin/java` stub | `make setup-toolchain` |
| `mise ERROR ... are not trusted` | Fresh clone or new worktree | `make setup-toolchain` |
| `ruby gems: The following gems are missing` after installing | Gems went in under another Ruby, before mise's 3.3 was active | `make setup-toolchain` (mise first, then `make install`) |
| `pod: not found`, or CocoaPods complains about UTF-8 | Not installed in mise's Ruby; locale not UTF-8 | `make setup-ios` |
| `adb: not found` while `$ANDROID_HOME` is set | Shell without mise activation, or an old `.mise.toml` that loads `.env.local` after `_.path` | Activate mise, or `mise exec -- make doctor` |
| `make check-release` fails with `invalid multibyte char (US-ASCII)` in `fastlane/lanes/shared.rb` | The shell sets no locale, so Ruby reads source as ASCII | Run through mise (its `[env]` defaults `LANG` to `en_US.UTF-8`), or export `LANG=en_US.UTF-8` |
| `$ANDROID_HOME is not set` | No SDK yet, or `.env.local` missing | `make setup-android` |

### Android build (`make dev-android`)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Failed to install the following SDK components: ndk;...` with `SocketException: Connection reset` | Gradle downloads missing SDK packages mid-build, once, without retrying | `make setup-android` (preinstalls with retries), then rebuild |
| Gradle installs `ndk;27.0.12077973`, `build-tools;35.0.0`, `cmake;3.22.1` you never asked for | The Android Gradle Plugin's defaults for libraries that pin nothing | Already in `ANDROID_AGP_DEFAULT_PACKAGES`; bump there with AGP |
| `avdmanager: Package path is not valid` | Homebrew's `android-commandlinetools` looks for the SDK next to itself | Use the SDK's own `cmdline-tools/latest` (what `make setup-android` installs) |
| Gradle warns `This version only understands SDK XML versions up to 3 but an SDK XML file of version 4 was encountered` | The command-line tools (23) are newer than the Android Gradle Plugin (8.12) | Harmless; it goes away when React Native moves to a newer AGP |
| `sdkmanager is deprecated` / `--licenses option is no longer needed` | Command-line tools 23+: `android sdk` replaces sdkmanager and accepts licences on install | Nothing to do; `make setup-android` asks before the first install |

### iOS build (`make dev-ios`)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `CommandError: No code signing certificates are available to use.` on a simulator build | Expo signs simulator builds when the entitlements need it, and `app.config.ts` writes an empty Associated Domains list when `EXPO_PUBLIC_WEB_DOMAIN` is unset | Omit `associatedDomains` when empty (the real fix), or sign in to Xcode with an Apple ID; as a local stopgap, delete the key from the generated `ios/<App>/<App>.entitlements` (`/usr/libexec/PlistBuddy -c 'Delete :com.apple.developer.associated-domains'`) |
| Claude's simulator panel says "Xcode is installed but not selected" although `xcode-select -p` is right | The panel's own check | `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` once |
| `make dev-ios` and `make dev-android` fight over Metro's port (`METRO_PORT`, see `make ports`) | Each becomes Metro when its build finishes | One at a time, or stop the first; one Metro serves both platforms |

### E2E (`make test-e2e-android`, `make test-e2e-ios`)

| Symptom | Cause | Fix |
| --- | --- | --- |
| Android: all 6 flows fail, `00-launch` never sees `home-screen`, emulator ends on the launcher | `00-launch.yaml` presses Back to close the dev-menu intro, which only appears on an install's first run; with no menu, Back quits the app | `adb shell pm clear` with the app's id (`APP_ID` in `scripts/e2e/maestro-android.sh`), then re-run |
| Android: all flows fail within milliseconds; `.maestro/output/maestro.log` has `DeviceServerDiedException ... device offline` | adb dropped the emulator for a moment | `adb wait-for-device`, re-run |
| Blank screen after the E2E script's deep link | The link was delivered into an already-running app pointed at a different Metro URL | Force-stop or `pm clear` the app first |
| Code changes do not show up | Metro was started with `CI=1` ("reloads are disabled") | Restart it with `make dev`, without `CI` |
| LogBox: `Can't perform a React state update on a component that hasn't mounted yet` from `useLinking.native.js` | expo-router's startup deep-link handling, intermittently on the first load after a large rebuild | Dismiss it; not an app bug. It can cover the tab bar, so dismiss before tapping |

## Where the evidence is

- `.maestro/output/<flow>/commands.json` and `screenshots/`, and
  `.maestro/output/maestro.log`: which step failed, and what was on screen.
- `$TMPDIR/emulator-<avd>.log`: an emulator started by `--boot`.
- `adb logcat -d --pid=$(adb shell pidof <APP_ID>)`: the app's
  own log; `ReactNativeJS` lines are JavaScript.
- `adb shell uiautomator dump /sdcard/ui.xml && adb shell cat /sdcard/ui.xml`:
  the Android view tree with every `resource-id` (testID).
- The Metro terminal: bundling errors and the app's `console` output.

## Tests

```bash
node --test scripts/setup/setup.test.mjs   # the setup scripts, against fakes (also in make test-scripts)
.claude/skills/native-setup/tests/run.sh   # this file's commands and paths still exist
```
