#!/usr/bin/env bash
# Proves CNG works from a clean checkout and that config plugins produced
# their native output. Never touches ./ios or ./android.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
rsync -a --exclude node_modules --exclude ios --exclude android --exclude .git . "$tmp/app"
ln -s "$PWD/node_modules" "$tmp/app/node_modules"
(
  cd "$tmp/app"
  # Call the expo binary directly rather than through `pnpm exec`: pnpm may
  # decide to install, and an install here would write through the symlink
  # into the real node_modules.
  APP_VARIANT=production APP_VERSION=1.2.3 APP_BUILD_NUMBER=42 EXPO_NO_GIT_STATUS=1 ./node_modules/.bin/expo prebuild --platform all --clean --no-install >/dev/null
  grep -q '<key>AppBuildStamp</key>' ios/*/Info.plist || { echo "iOS Info.plist lacks AppBuildStamp" >&2; exit 1; }
  grep -q 'ITSAppUsesNonExemptEncryption' ios/*/Info.plist || { echo "iOS Info.plist lacks ITSAppUsesNonExemptEncryption" >&2; exit 1; }
  grep -q 'android:name="AppBuildStamp"' android/app/src/main/AndroidManifest.xml || { echo "AndroidManifest lacks AppBuildStamp" >&2; exit 1; }
  grep -q 'ANDROID_UPLOAD_STORE_FILE' android/app/build.gradle || { echo "build.gradle lacks release signing config" >&2; exit 1; }
  grep -q 'signingConfig signingConfigs.release' android/app/build.gradle || { echo "release buildType is not pointed at the release signingConfig" >&2; exit 1; }
  grep -q 'ANDROID_UPLOAD_\* gradle properties not set: release build will be signed with the DEBUG keystore' android/app/build.gradle || { echo "build.gradle lacks the debug-keystore fallback warning" >&2; exit 1; }
  grep -q '^reactNativeArchitectures=armeabi-v7a,arm64-v8a' android/gradle.properties || { echo "gradle.properties lacks arm-only ABIs" >&2; exit 1; }
  grep -q 'versionCode 42' android/app/build.gradle || { echo "versionCode not injected" >&2; exit 1; }
  grep -q '<string>1.2.3</string>' ios/*/Info.plist || { echo "CFBundleShortVersionString not injected" >&2; exit 1; }
  grep -q 'UIAppFonts' ios/*/Info.plist || { echo "iOS Info.plist lacks UIAppFonts (bundled font not registered)" >&2; exit 1; }
  find ios -type d -name 'SplashScreenBackground.colorset' | grep -q . || { echo "iOS project lacks SplashScreenBackground.colorset (expo-splash-screen did not run)" >&2; exit 1; }
)
echo "prebuild check passed"
