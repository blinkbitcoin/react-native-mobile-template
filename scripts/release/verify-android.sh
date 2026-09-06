#!/usr/bin/env bash
# Post-build verification gate for the Android release artifacts.
#
#   bash scripts/release/verify-android.sh <aab> <apk> [--cert-sha256 <fp>]
#
# The AAB is what Play receives; the APK is the universal one built from that
# same bundle, and is the only one of the two whose contents can be read with
# ordinary tools. Both are checked, and they are checked against each other:
# an APK built from a different bundle than the one being uploaded is exactly
# the mistake this gate exists to catch.
#
# Prints one `status check: detail` line per check (ok | warn | skip | FAIL),
# mirrors the list into $GITHUB_STEP_SUMMARY when CI set it, and exits 1 if
# anything FAILed. A missing tool is a skip, not a failure.
#
# Env read: APP_VERSION, APP_BUILD_NUMBER, ANDROID_PACKAGE, OTA_ENABLED,
#           BUILD_INFO_FILE (default build-info.json), ANDROID_HOME,
#           BUNDLETOOL_JAR, EXPO_PUBLIC_*.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck source=scripts/release/lib/verify-common.sh
. "$here/lib/verify-common.sh"

# Expo SDK 57's own floor. A release built below it would not install on the
# devices the store listing promises.
MIN_SDK_FLOOR=24

usage() {
  echo "usage: verify-android.sh <aab> <apk> [--cert-sha256 <fingerprint>]" >&2
  exit 2
}

aab=''
apk=''
cert_sha=''
while [ $# -gt 0 ]; do
  case "$1" in
    --cert-sha256)
      shift
      [ $# -gt 0 ] || usage
      cert_sha="$1"
      ;;
    -h | --help) usage ;;
    -*) usage ;;
    *)
      if [ -z "$aab" ]; then
        aab="$1"
      elif [ -z "$apk" ]; then
        apk="$1"
      else
        usage
      fi
      ;;
  esac
  shift
done
# The runbook documents ANDROID_UPLOAD_CERT_SHA256 as the variable this gate
# reads, so the flag is the override rather than the only way in.
[ -n "$cert_sha" ] || cert_sha="${ANDROID_UPLOAD_CERT_SHA256:-}"
[ -n "$aab" ] && [ -n "$apk" ] || usage
for f in "$aab" "$apk"; do
  [ -f "$f" ] || {
    echo "verify-android.sh: no such file: $f" >&2
    exit 2
  }
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

vc_reset
vc_ok artifacts "$(basename "$aab") + $(basename "$apk")"

aapt2="$(vc_android_build_tool aapt2 || true)"
apksigner="$(vc_android_build_tool apksigner || true)"

# --- APK manifest -----------------------------------------------------------
badging=''
if [ -z "$aapt2" ]; then
  vc_skip apk-manifest 'requires aapt2 (install Android SDK build-tools or set ANDROID_HOME)'
else
  badging="$("$aapt2" dump badging "$apk" 2>/dev/null || true)"
  if [ -z "$badging" ]; then
    vc_fail apk-manifest "aapt2 could not read $apk"
  else
    apk_package="$(vc_badging_field "$badging" name)"
    apk_version_code="$(vc_badging_field "$badging" versionCode)"
    apk_version_name="$(vc_badging_field "$badging" versionName)"
    vc_ok apk-manifest "$apk_package $apk_version_name ($apk_version_code)"

    if [ -n "${ANDROID_PACKAGE:-}" ]; then
      vc_expect apk-package "$ANDROID_PACKAGE" "$apk_package"
    else
      vc_skip apk-package "ANDROID_PACKAGE not set; artifact says $apk_package"
    fi
    if [ -n "${APP_VERSION:-}" ]; then
      vc_expect apk-version-name "$APP_VERSION" "$apk_version_name"
    else
      vc_skip apk-version-name "APP_VERSION not set; artifact says $apk_version_name"
    fi
    if [ -n "${APP_BUILD_NUMBER:-}" ]; then
      vc_expect apk-version-code "$APP_BUILD_NUMBER" "$apk_version_code"
    else
      vc_skip apk-version-code "APP_BUILD_NUMBER not set; artifact says $apk_version_code"
    fi

    vc_verdict debuggable "$(vc_debuggable_verdict "$badging")"
    # aapt2 prints `minSdkVersion:'24'`; aapt1 printed `sdkVersion:'24'`.
    min_sdk="$(vc_badging_line_value "$badging" minSdkVersion)"
    [ -n "$min_sdk" ] || min_sdk="$(vc_badging_line_value "$badging" sdkVersion)"
    vc_verdict min-sdk "$(vc_min_sdk_verdict "$min_sdk" "$MIN_SDK_FLOOR")"
  fi
fi

# --- AAB manifest -----------------------------------------------------------
# bundletool is the only thing that can read the protobuf manifest inside an
# AAB, and the AAB -- not the APK -- is what Play actually publishes.
if ! vc_find_bundletool; then
  # shellcheck disable=SC2016 # backticks are markdown, not a command substitution
  vc_skip aab-manifest 'requires bundletool (`brew install bundletool`, or set BUNDLETOOL_JAR)'
else
  aab_manifest="$("${VC_BUNDLETOOL[@]}" dump manifest --bundle "$aab" 2>/dev/null || true)"
  if [ -z "$aab_manifest" ]; then
    vc_fail aab-manifest "bundletool could not read $aab"
  else
    attr() { # <attribute name>
      printf '%s\n' "$aab_manifest" | sed -n "s/.*android:$1=\"\([^\"]*\)\".*/\1/p" | head -1
    }
    aab_package="$(printf '%s\n' "$aab_manifest" | sed -n 's/.*[^a-zA-Z]package="\([^"]*\)".*/\1/p' | head -1)"
    aab_version_code="$(attr versionCode)"
    aab_version_name="$(attr versionName)"
    vc_ok aab-manifest "$aab_package $aab_version_name ($aab_version_code)"

    if [ -n "${APP_BUILD_NUMBER:-}" ]; then
      vc_expect aab-version-code "$APP_BUILD_NUMBER" "$aab_version_code"
    else
      vc_skip aab-version-code "APP_BUILD_NUMBER not set; artifact says $aab_version_code"
    fi
    if [ -n "${APP_VERSION:-}" ]; then
      vc_expect aab-version-name "$APP_VERSION" "$aab_version_name"
    else
      vc_skip aab-version-name "APP_VERSION not set; artifact says $aab_version_name"
    fi
    if [ -n "$badging" ]; then
      vc_expect aab-matches-apk "$aab_package $aab_version_name $aab_version_code" \
        "$(vc_badging_field "$badging" name) $(vc_badging_field "$badging" versionName) $(vc_badging_field "$badging" versionCode)"
    else
      vc_skip aab-matches-apk 'the APK manifest could not be read'
    fi

    # The expo-updates meta-data the config plugin injects, read from the AAB
    # so this holds for the artifact Play publishes.
    ota_expected="$(vc_bool "${OTA_ENABLED:-}")"
    ota_actual='absent'
    if printf '%s\n' "$aab_manifest" | grep -q 'expo.modules.updates.ENABLED'; then
      ota_actual="$(printf '%s\n' "$aab_manifest" |
        grep -A2 'expo.modules.updates.ENABLED' |
        sed -n 's/.*android:value="\([^"]*\)".*/\1/p' | head -1)"
      case "$ota_actual" in true | false) ;; *) ota_actual='absent' ;; esac
    fi
    vc_verdict ota "$(vc_ota_verdict "$ota_expected" "$ota_actual")"

    if [ "$ota_actual" = 'true' ]; then
      if printf '%s\n' "$aab_manifest" | grep -q 'expo.modules.updates.CODE_SIGNING_CERTIFICATE'; then
        cert="$repo_root/certs/expo-updates-cert.pem"
        if [ -f "$cert" ] && command -v shasum >/dev/null 2>&1; then
          vc_verdict ota-cert "$(vc_cert_placeholder_verdict "$(shasum -a 256 "$cert" | cut -d' ' -f1)")"
        else
          vc_skip ota-cert 'certs/expo-updates-cert.pem not readable from here'
        fi
      else
        vc_fail ota-cert 'updates are enabled but the manifest carries no CODE_SIGNING_CERTIFICATE meta-data'
      fi
    fi
  fi
fi

# --- native ABIs ------------------------------------------------------------
if vc_require_cmd abis unzip; then
  vc_verdict apk-abis "$(vc_abi_verdict "$(unzip -Z1 "$apk" 2>/dev/null || true)")"
  vc_verdict aab-abis "$(vc_abi_verdict "$(unzip -Z1 "$aab" 2>/dev/null || true)")"
fi

# --- signing ----------------------------------------------------------------
if [ -z "$apksigner" ]; then
  vc_skip signature 'requires apksigner (install Android SDK build-tools or set ANDROID_HOME)'
elif ! "$apksigner" verify --print-certs "$apk" >"$work/certs.txt" 2>"$work/certs.err"; then
  vc_fail signature "apksigner verify failed: $(tr '\n' ' ' <"$work/certs.err")"
else
  actual_sha="$(sed -n 's/.*SHA-256 digest: *\([0-9a-fA-F]*\).*/\1/p' "$work/certs.txt" | head -1)"
  vc_ok signature "apksigner verified $(basename "$apk")"
  if [ -n "$cert_sha" ]; then
    vc_verdict signing-cert "$(vc_cert_verdict "$cert_sha" "$actual_sha")"
  else
    vc_skip signing-cert "no --cert-sha256 given; APK is signed by ${actual_sha:-unknown}"
  fi
fi

# --- JS bundle --------------------------------------------------------------
if vc_require_cmd bundle unzip; then
  if unzip -q -o -j "$apk" 'assets/index.android.bundle' -d "$work" 2>/dev/null; then
    bundle="$work/index.android.bundle"
    vc_verdict hermes "$(vc_hermes_verdict "$bundle")"
    vc_verdict dev-server "$(vc_dev_server_verdict "$bundle")"
    env_example="$repo_root/.env.example"
    if [ -f "$env_example" ]; then
      vc_verdict expo-public "$(vc_public_env_verdict "$bundle" "$(cat "$env_example")")"
    else
      vc_skip expo-public 'no .env.example next to the scripts'
    fi
  else
    vc_fail bundle 'no assets/index.android.bundle in the APK'
  fi
fi

# --- ProGuard/R8 mapping ----------------------------------------------------
# `fastlane android build` copies mapping.txt next to the AAB when minification
# produced one. No mapping is not a failure (this template ships with R8 off),
# but an empty one means a broken upload of unusable symbols.
mapping="${ANDROID_MAPPING_TXT:-$(dirname "$aab")/mapping.txt}"
if [ ! -f "$mapping" ]; then
  vc_skip mapping "no mapping.txt at $mapping (minification off?)"
elif [ -s "$mapping" ]; then
  vc_ok mapping "$(wc -l <"$mapping" | tr -d ' ') lines"
else
  vc_fail mapping "$mapping is empty"
fi

# --- provenance -------------------------------------------------------------
# build-info.json is the release's provenance record; the workflow fills in
# `artifacts.apkSha256` as each artifact lands. Absent, there is nothing to
# compare against and the check is skipped rather than invented.
build_info="${BUILD_INFO_FILE:-$repo_root/build-info.json}"
if [ ! -f "$build_info" ]; then
  vc_skip apk-sha "no build-info.json at $build_info"
elif ! vc_require_cmd apk-sha node shasum; then
  : # vc_require_cmd already recorded the skip
else
  expected_sha="$(BUILD_INFO_PATH="$build_info" node -e '
const info = require("node:fs").readFileSync(process.env.BUILD_INFO_PATH, "utf8");
process.stdout.write(String(JSON.parse(info)?.artifacts?.apkSha256 ?? ""));
' 2>/dev/null || true)"
  if [ -z "$expected_sha" ]; then
    vc_skip apk-sha 'build-info.json carries no artifacts.apkSha256'
  else
    vc_verdict apk-sha "$(vc_sha_verdict 'APK' "$expected_sha" "$(shasum -a 256 "$apk" | cut -d' ' -f1)")"
  fi
fi

# --- store metadata ---------------------------------------------------------
vc_verdict metadata "$(vc_metadata_placeholder_verdict "$repo_root")"

vc_summary 'Android artifact verification' || exit 1
