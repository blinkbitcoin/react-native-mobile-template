#!/usr/bin/env bash
# Post-build verification gate for an iOS release artifact.
#
#   bash scripts/release/verify-ios.sh <path> [--no-signing] [--dsym <path>]
#
# <path> is an .ipa, an .xcarchive, or the .app inside one. Everything that can
# be wrong about a build *after* it succeeded is checked here: the wrong
# version, a simulator slice, a debug JS bundle pointing at a laptop's Metro,
# OTA silently off, a missing EXPO_PUBLIC_ value.
#
# Prints one `status check: detail` line per check (ok | warn | skip | FAIL),
# mirrors the list into $GITHUB_STEP_SUMMARY when CI set it, and exits 1 if
# anything FAILed. A missing tool is a skip, not a failure.
#
# Env read: APP_VERSION, APP_BUILD_NUMBER, IOS_BUNDLE_ID, OTA_ENABLED,
#           EXPO_PUBLIC_* (values must be inlined in the bundle).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck source=scripts/release/lib/verify-common.sh
. "$here/lib/verify-common.sh"

usage() {
  echo "usage: verify-ios.sh <path to .ipa|.xcarchive|.app> [--no-signing] [--dsym <path>]" >&2
  exit 2
}

artifact=''
check_signing=1
dsym_path=''
while [ $# -gt 0 ]; do
  case "$1" in
    --no-signing) check_signing=0 ;;
    --dsym)
      shift
      [ $# -gt 0 ] || usage
      dsym_path="$1"
      ;;
    -h | --help) usage ;;
    -*) usage ;;
    *)
      [ -z "$artifact" ] || usage
      artifact="$1"
      ;;
  esac
  shift
done
[ -n "$artifact" ] || usage
[ -e "$artifact" ] || {
  echo "verify-ios.sh: no such artifact: $artifact" >&2
  exit 2
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

vc_reset

# --- resolve the .app -------------------------------------------------------
# An .ipa is a zip whose Payload/ holds the app; an .xcarchive keeps it under
# Products/Applications. Both reduce to "a directory called *.app".
app=''
case "$artifact" in
  *.ipa)
    if vc_require_cmd artifact unzip; then
      unzip -q -o "$artifact" -d "$work/ipa"
      app="$(find "$work/ipa/Payload" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null || true)"
    fi
    ;;
  *.xcarchive)
    app="$(find "$artifact/Products/Applications" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null || true)"
    ;;
  *.app)
    app="$artifact"
    ;;
  *)
    vc_fail artifact "unsupported artifact type: $artifact (want .ipa, .xcarchive or .app)"
    ;;
esac

if [ -z "$app" ] || [ ! -d "$app" ]; then
  vc_fail artifact "no .app found in $artifact"
  vc_summary 'iOS artifact verification' || exit 1
  exit 1
fi
vc_ok artifact "$(basename "$app") from $(basename "$artifact")"

plist="$app/Info.plist"
[ -f "$plist" ] || vc_fail info-plist "no Info.plist in $app"

# `plutil -extract ... raw` reads binary and XML plists alike, which matters:
# the plist in a built .app is binary, the one in the generated project is XML.
plist_value() { # <key> [<plist>]
  plutil -extract "$1" raw -o - "${2:-$plist}" 2>/dev/null || true
}

# --- version, build number, bundle id ---------------------------------------
if vc_require_cmd version plutil; then
  version="$(plist_value CFBundleShortVersionString)"
  build_number="$(plist_value CFBundleVersion)"
  bundle_id="$(plist_value CFBundleIdentifier)"

  if [ -n "${APP_VERSION:-}" ]; then
    vc_expect version "$APP_VERSION" "$version"
  else
    vc_skip version "APP_VERSION not set; artifact says $version"
  fi
  if [ -n "${APP_BUILD_NUMBER:-}" ]; then
    vc_expect build-number "$APP_BUILD_NUMBER" "$build_number"
  else
    vc_skip build-number "APP_BUILD_NUMBER not set; artifact says $build_number"
  fi
  if [ -n "${IOS_BUNDLE_ID:-}" ]; then
    vc_expect bundle-id "$IOS_BUNDLE_ID" "$bundle_id"
  else
    vc_skip bundle-id "IOS_BUNDLE_ID not set; artifact says $bundle_id"
  fi
fi

# --- architecture -----------------------------------------------------------
executable="$(plist_value CFBundleExecutable)"
binary="$app/${executable:-$(basename "${app%.app}")}"
if [ ! -f "$binary" ]; then
  vc_fail arch "no executable at $binary"
elif vc_require_cmd arch lipo; then
  vc_verdict arch "$(vc_arch_verdict "$(lipo -archs "$binary" 2>/dev/null || true)")"
fi

# --- signing ----------------------------------------------------------------
# `--no-signing` is the local proof: `fastlane ios build skip_signing:true`
# produces an archive with no identity at all, and checking it would only ever
# fail.
if [ "$check_signing" -eq 0 ]; then
  vc_skip signing "--no-signing given (unsigned local build)"
  vc_skip provisioning "--no-signing given (unsigned local build)"
  vc_skip get-task-allow "--no-signing given (unsigned local build)"
elif vc_require_cmd signing codesign; then
  if codesign --verify --strict --verbose=2 "$app" >"$work/codesign.txt" 2>&1; then
    details="$(codesign -dv --verbose=4 "$app" 2>&1 || true)"
    team="$(printf '%s\n' "$details" | sed -n 's/^TeamIdentifier=\(.*\)$/\1/p' | head -1)"
    authority="$(printf '%s\n' "$details" | sed -n 's/^Authority=\(.*\)$/\1/p' | head -1)"
    if [ -z "$team" ] || [ "$team" = 'not set' ]; then
      vc_fail signing "signed without a team identifier (ad-hoc?): ${authority:-no authority}"
    else
      vc_ok signing "$authority (team $team)"
    fi
  else
    vc_fail signing "codesign --verify failed: $(tr '\n' ' ' <"$work/codesign.txt")"
  fi

  if [ -f "$app/embedded.mobileprovision" ]; then
    vc_ok provisioning 'embedded.mobileprovision present'
  else
    vc_fail provisioning 'no embedded.mobileprovision in the .app'
  fi

  # get-task-allow lets a debugger attach. App Store review rejects it, and it
  # is the single entitlement a wrongly signed release is most likely to carry.
  entitlements="$(codesign -d --entitlements - --xml "$app" 2>/dev/null || true)"
  if printf '%s\n' "$entitlements" | grep -q 'get-task-allow'; then
    if printf '%s\n' "$entitlements" | grep -A1 'get-task-allow' | grep -q '<true/>'; then
      vc_fail get-task-allow 'get-task-allow is true (a debug entitlement in a release build)'
    else
      vc_ok get-task-allow 'get-task-allow is false'
    fi
  else
    vc_ok get-task-allow 'no get-task-allow entitlement'
  fi
fi

# --- OTA (expo-updates) -----------------------------------------------------
expo_plist="$app/Expo.plist"
ota_expected="$(vc_bool "${OTA_ENABLED:-}")"
if [ ! -f "$expo_plist" ]; then
  vc_verdict ota "$(vc_ota_verdict "$ota_expected" 'absent')"
elif vc_require_cmd ota plutil; then
  ota_actual="$(plist_value EXUpdatesEnabled "$expo_plist")"
  case "$ota_actual" in true | false) ;; *) ota_actual='absent' ;; esac
  vc_verdict ota "$(vc_ota_verdict "$ota_expected" "$ota_actual")"

  if [ "$ota_actual" = 'true' ]; then
    url="$(plist_value EXUpdatesURL "$expo_plist")"
    if [ -n "$url" ]; then
      vc_ok ota-url "$url"
    else
      vc_fail ota-url 'updates are enabled but Expo.plist carries no EXUpdatesURL'
    fi
    cert="$repo_root/certs/expo-updates-cert.pem"
    if [ -f "$cert" ] && command -v shasum >/dev/null 2>&1; then
      vc_verdict ota-cert "$(vc_cert_placeholder_verdict "$(shasum -a 256 "$cert" | cut -d' ' -f1)")"
    else
      vc_skip ota-cert 'certs/expo-updates-cert.pem not readable from here'
    fi
  fi
fi

# --- JS bundle --------------------------------------------------------------
bundle="$app/main.jsbundle"
vc_verdict hermes "$(vc_hermes_verdict "$bundle")"
vc_verdict dev-server "$(vc_dev_server_verdict "$bundle")"

env_example="$repo_root/.env.example"
if [ -f "$env_example" ] && [ -f "$bundle" ]; then
  vc_verdict expo-public "$(vc_public_env_verdict "$bundle" "$(cat "$env_example")")"
else
  vc_skip expo-public 'no .env.example or no JS bundle'
fi

# --- dSYM -------------------------------------------------------------------
# Symbolication is only useful if the dSYM belongs to *this* binary; a UUID
# mismatch is how a crash report ends up as a wall of hex addresses.
if [ -z "$dsym_path" ]; then
  vc_skip dsym-uuid 'no --dsym given'
elif [ ! -e "$dsym_path" ]; then
  vc_fail dsym-uuid "no such dSYM: $dsym_path"
elif vc_require_cmd dsym-uuid dwarfdump; then
  dsym_dir="$dsym_path"
  case "$dsym_path" in
    *.zip)
      if vc_require_cmd dsym-uuid unzip; then
        unzip -q -o "$dsym_path" -d "$work/dsym"
        dsym_dir="$work/dsym"
      fi
      ;;
    *) ;;
  esac
  dsym_out=''
  while IFS= read -r found; do
    dsym_out="$dsym_out$(dwarfdump --uuid "$found" 2>/dev/null || true)"$'\n'
  done < <(find "$dsym_dir" -name '*.dSYM' -maxdepth 3 -print 2>/dev/null)
  vc_verdict dsym-uuid "$(vc_dsym_verdict "$(dwarfdump --uuid "$binary" 2>/dev/null || true)" "$dsym_out")"
fi

# --- store metadata ---------------------------------------------------------
vc_verdict metadata "$(vc_metadata_placeholder_verdict "$repo_root")"

vc_summary 'iOS artifact verification' || exit 1
