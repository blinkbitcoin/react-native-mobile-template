#!/usr/bin/env bash
# Proves CNG works from a clean checkout and that config plugins produced
# their native output. Never touches ./ios or ./android.
#
# Two passes, each into its own temp dir:
#   1. default   — OTA off; asserts the plugin output and the version injection
#   2. OTA on    — OTA_ENABLED=true; asserts the expo-updates URL and the
#                  code-signing certificate reached the native projects
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Copies the repo into "$tmp/$1" and prebuilds both platforms there. Extra
# arguments are `KEY=VALUE` environment entries for the prebuild.
prepare() {
  local name="$1"
  shift
  rsync -a --exclude node_modules --exclude ios --exclude android --exclude .git "$root/" "$tmp/$name"
  ln -s "$root/node_modules" "$tmp/$name/node_modules"
  # Call the expo binary directly rather than through `pnpm exec`: pnpm may
  # decide to install, and an install here would write through the symlink
  # into the real node_modules.
  (cd "$tmp/$name" && env "$@" APP_VARIANT=production APP_VERSION=1.2.3 APP_BUILD_NUMBER=42 EXPO_NO_GIT_STATUS=1 \
    ./node_modules/.bin/expo prebuild --platform all --clean --no-install >/dev/null)
}

prepare default
(
  cd "$tmp/default"
  grep -q '<key>AppBuildStamp</key>' ios/*/Info.plist || { echo "iOS Info.plist lacks AppBuildStamp" >&2; exit 1; }
  grep -q 'ITSAppUsesNonExemptEncryption' ios/*/Info.plist || { echo "iOS Info.plist lacks ITSAppUsesNonExemptEncryption" >&2; exit 1; }
  grep -q 'android:name="AppBuildStamp"' android/app/src/main/AndroidManifest.xml || { echo "AndroidManifest lacks AppBuildStamp" >&2; exit 1; }
  grep -q 'ANDROID_UPLOAD_STORE_FILE' android/app/build.gradle || { echo "build.gradle lacks release signing config" >&2; exit 1; }
  grep -q 'signingConfig signingConfigs.release' android/app/build.gradle || { echo "release buildType is not pointed at the release signingConfig" >&2; exit 1; }
  grep -q 'ANDROID_UPLOAD_\* gradle properties not set: release build will be signed with the DEBUG keystore' android/app/build.gradle || { echo "build.gradle lacks the debug-keystore fallback warning" >&2; exit 1; }
  grep -q '^reactNativeArchitectures=armeabi-v7a,arm64-v8a' android/gradle.properties || { echo "gradle.properties lacks arm-only ABIs" >&2; exit 1; }
  grep -q '^org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m' android/gradle.properties || { echo "gradle.properties lacks the enlarged Gradle JVM args" >&2; exit 1; }
  grep -q 'versionCode 42' android/app/build.gradle || { echo "versionCode not injected" >&2; exit 1; }
  grep -q '<string>1.2.3</string>' ios/*/Info.plist || { echo "CFBundleShortVersionString not injected" >&2; exit 1; }
  grep -q 'UIAppFonts' ios/*/Info.plist || { echo "iOS Info.plist lacks UIAppFonts (bundled font not registered)" >&2; exit 1; }
  find ios -type d -name 'SplashScreenBackground.colorset' | grep -q . || { echo "iOS project lacks SplashScreenBackground.colorset (expo-splash-screen did not run)" >&2; exit 1; }
  # OTA is off unless OTA_ENABLED=true, so the native projects must say so.
  grep -A1 '<key>EXUpdatesEnabled</key>' ios/*/Supporting/Expo.plist | grep -q '<false/>' || { echo "Expo.plist does not disable EXUpdatesEnabled with OTA off" >&2; exit 1; }
  ! grep -q 'EXUpdatesCodeSigningCertificate' ios/*/Supporting/Expo.plist || { echo "Expo.plist carries a code-signing certificate with OTA off" >&2; exit 1; }
  grep -q 'expo.modules.updates.ENABLED" android:value="false"' android/app/src/main/AndroidManifest.xml || { echo "AndroidManifest does not disable expo.modules.updates.ENABLED with OTA off" >&2; exit 1; }
  ! grep -q 'expo.modules.updates.CODE_SIGNING_CERTIFICATE' android/app/src/main/AndroidManifest.xml || { echo "AndroidManifest carries a code-signing certificate with OTA off" >&2; exit 1; }
)
echo "prebuild check passed (OTA off)"

prepare ota OTA_ENABLED=true EXPO_UPDATES_URL=https://updates.example.com/manifest
(
  cd "$tmp/ota"
  grep -A1 '<key>EXUpdatesEnabled</key>' ios/*/Supporting/Expo.plist | grep -q '<true/>' || { echo "Expo.plist does not enable EXUpdatesEnabled with OTA on" >&2; exit 1; }
  grep -q 'https://updates.example.com/manifest' ios/*/Supporting/Expo.plist || { echo "Expo.plist lacks EXUpdatesURL with OTA on" >&2; exit 1; }
  grep -q 'EXUpdatesCodeSigningCertificate' ios/*/Supporting/Expo.plist || { echo "Expo.plist lacks EXUpdatesCodeSigningCertificate with OTA on" >&2; exit 1; }
  grep -q 'BEGIN CERTIFICATE' ios/*/Supporting/Expo.plist || { echo "Expo.plist code-signing certificate is not embedded" >&2; exit 1; }
  grep -q 'EXUpdatesCodeSigningMetadata' ios/*/Supporting/Expo.plist || { echo "Expo.plist lacks EXUpdatesCodeSigningMetadata with OTA on" >&2; exit 1; }
  grep -q 'https://updates.example.com/manifest' android/app/src/main/AndroidManifest.xml || { echo "AndroidManifest lacks the update URL with OTA on" >&2; exit 1; }
  grep -q 'expo.modules.updates.CODE_SIGNING_CERTIFICATE' android/app/src/main/AndroidManifest.xml || { echo "AndroidManifest lacks the code-signing certificate meta-data with OTA on" >&2; exit 1; }
)
echo "prebuild check passed (OTA on)"
