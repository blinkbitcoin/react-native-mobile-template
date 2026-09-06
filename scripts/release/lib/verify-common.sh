#!/usr/bin/env bash
# Shared helpers for the release verification gates (verify-ios.sh,
# verify-android.sh). Sourced, never executed.
#
# Two kinds of function live here:
#
#   1. Checklist plumbing -- `vc_ok`/`vc_warn`/`vc_skip`/`vc_fail` print one
#      `status check: detail` line each, count what happened, and `vc_summary`
#      replays the whole list into $GITHUB_STEP_SUMMARY when CI set it.
#   2. Pure verdict helpers -- they take text (a `lipo -archs` line, an aapt2
#      badging dump, a list of archive entries) and print `<status> <detail>`.
#      Nothing about them touches a real artifact, which is what makes
#      scripts/release/verify.test.mjs able to test the decisions themselves
#      instead of only the happy path of a 90 MB build.
#
# A status is one of: ok | warn | skip | FAIL. Only FAIL fails the gate.
# `skip` means "this check could not run" (a tool is missing, an input was not
# given) and is deliberately not a failure: the gates have to be usable on a
# laptop that has no bundletool.

# ---------------------------------------------------------------------------
# Checklist
# ---------------------------------------------------------------------------

VC_LINES=()
VC_FAILURES=0
VC_WARNINGS=0
VC_SKIPS=0

vc_reset() {
  VC_LINES=()
  VC_FAILURES=0
  VC_WARNINGS=0
  VC_SKIPS=0
}

vc_record() { # <status> <check> <detail...>
  local status="$1" check="$2"
  shift 2
  local line="$status $check: $*"
  VC_LINES+=("$line")
  printf '%s\n' "$line"
  case "$status" in
    FAIL) VC_FAILURES=$((VC_FAILURES + 1)) ;;
    warn) VC_WARNINGS=$((VC_WARNINGS + 1)) ;;
    skip) VC_SKIPS=$((VC_SKIPS + 1)) ;;
    *) ;;
  esac
}

vc_ok() { vc_record ok "$@"; }
vc_warn() { vc_record warn "$@"; }
vc_skip() { vc_record skip "$@"; }
vc_fail() { vc_record FAIL "$@"; }

# Turns `<status> <detail>` from a pure helper into a checklist line.
vc_verdict() { # <check> <verdict>
  local check="$1" verdict="$2"
  vc_record "${verdict%% *}" "$check" "${verdict#* }"
}

vc_expect() { # <check> <expected> <actual>
  if [ "$2" = "$3" ]; then
    vc_ok "$1" "$3"
  else
    vc_fail "$1" "expected '$2', got '$3'"
  fi
}

# Every check names the tools it needs. A missing tool is a skip, not a
# failure -- but it is a *loud* skip, and vc_summary counts it.
vc_require_cmd() { # <check> <cmd>...
  local check="$1"
  shift
  local cmd
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      vc_skip "$check" "requires $cmd, which is not on PATH"
      return 1
    fi
  done
  return 0
}

vc_icon() { # <status>
  case "$1" in
    ok) printf '✅' ;;
    warn) printf '⚠️' ;;
    skip) printf '⏭️' ;;
    *) printf '❌' ;;
  esac
}

# Prints the tally, mirrors the checklist into the job summary, and returns
# non-zero when anything failed -- the callers turn that into `exit 1`.
vc_summary() { # <title>
  local title="$1" total="${#VC_LINES[@]}" line status rest check detail
  printf '\n%s — %d checks, %d failed, %d warnings, %d skipped\n' \
    "$title" "$total" "$VC_FAILURES" "$VC_WARNINGS" "$VC_SKIPS"

  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      printf '### %s\n\n' "$title"
      printf '| | Check | Detail |\n| --- | --- | --- |\n'
      if [ "$total" -gt 0 ]; then
        for line in "${VC_LINES[@]}"; do
          status="${line%% *}"
          rest="${line#* }"
          check="${rest%%:*}"
          detail="${rest#*: }"
          # shellcheck disable=SC2016 # the backticks are markdown code spans
          printf '| %s | `%s` | %s |\n' "$(vc_icon "$status")" "$check" "$detail"
        done
      fi
      printf '\n%d checks, %d failed, %d warnings, %d skipped\n\n' \
        "$total" "$VC_FAILURES" "$VC_WARNINGS" "$VC_SKIPS"
    } >>"$GITHUB_STEP_SUMMARY"
  fi

  [ "$VC_FAILURES" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Pure verdict helpers
# ---------------------------------------------------------------------------

# `lipo -archs` output. A store build is arm64-only: an x86_64 slice means the
# binary was archived for the simulator, which the store rejects and which no
# device can run.
vc_arch_verdict() { # <archs>
  local archs
  archs="$(printf '%s\n' "$1" | tr -s ' \t' '\n' | sed '/^$/d' | sort -u | paste -sd' ' - || true)"
  if [ -z "$archs" ]; then
    printf 'FAIL no architectures reported\n'
  elif [ "$archs" = "arm64" ]; then
    printf 'ok arm64 only\n'
  else
    printf 'FAIL expected arm64 only, got %s\n' "$archs"
  fi
}

# ABIs Play has not accepted for phones in years, and which would only ever be
# in a release artifact by accident (a stray `reactNativeArchitectures`).
VC_FORBIDDEN_ABI='^(x86|x86_64|mips|mips64)$'
VC_ARM_ABI='^(arm64-v8a|armeabi-v7a)$'

# Native ABIs from a list of archive entry paths (`unzip -Z1` output for an
# APK or an AAB -- `lib/<abi>/x.so` and `base/lib/<abi>/x.so` both parse).
vc_abi_verdict() { # <entry paths, newline separated>
  local abis all forbidden arm
  abis="$(printf '%s\n' "$1" | sed -n 's#^.*lib/\([A-Za-z0-9_-]*\)/[^/]*\.so$#\1#p' | sort -u || true)"
  if [ -z "$abis" ]; then
    printf 'FAIL no native libraries found\n'
    return 0
  fi
  all="$(printf '%s\n' "$abis" | paste -sd' ' - || true)"
  forbidden="$(printf '%s\n' "$abis" | grep -E "$VC_FORBIDDEN_ABI" | paste -sd' ' - || true)"
  if [ -n "$forbidden" ]; then
    printf 'FAIL forbidden ABI present: %s (all: %s)\n' "$forbidden" "$all"
    return 0
  fi
  arm="$(printf '%s\n' "$abis" | grep -E "$VC_ARM_ABI" | paste -sd' ' - || true)"
  if [ -z "$arm" ]; then
    printf 'FAIL no arm ABI among: %s\n' "$all"
    return 0
  fi
  printf 'ok %s\n' "$all"
}

# A field off aapt2's `package:` line (`name`, `versionCode`, `versionName`).
# Scoped to that one line on purpose: `name='...'` also appears on every
# uses-permission and launchable-activity line.
vc_badging_field() { # <badging output> <field>
  printf '%s\n' "$1" | sed -n '/^package:/p' | head -1 |
    sed -n "s/.*[[:space:]]$2='\([^']*\)'.*/\1/p" || true
}

# A single-quoted value off a `<prefix>:'<value>'` badging line (sdkVersion,
# targetSdkVersion).
vc_badging_line_value() { # <badging output> <prefix>
  printf '%s\n' "$1" | sed -n "s/^$2:'\([^']*\)'.*/\1/p" | head -1 || true
}

# A debuggable release build hands anyone with the APK a debugger session
# against production data.
vc_debuggable_verdict() { # <badging output>
  if printf '%s\n' "$1" | grep -q '^application-debuggable'; then
    printf 'FAIL application-debuggable is set\n'
  else
    printf 'ok not debuggable\n'
  fi
}

vc_min_sdk_verdict() { # <actual> <minimum>
  case "$1" in
    '' | *[!0-9]*)
      printf 'FAIL could not read minSdkVersion (got %s)\n' "${1:-<empty>}"
      return 0
      ;;
    *) ;;
  esac
  if [ "$1" -ge "$2" ]; then
    printf 'ok minSdk %s (>= %s)\n' "$1" "$2"
  else
    printf 'FAIL minSdk %s is below the supported minimum %s\n' "$1" "$2"
  fi
}

# The Metro dev server, in every spelling a release bundle could carry it. Code
# that talks to it means the artifact was built with `--dev true` or against a
# running packager, and it would try to reach a laptop from a customer's phone.
VC_DEV_SERVER_HOST='(localhost|127\.0\.0\.1|10\.0\.2\.2):8081'
VC_DEV_SERVER_PATTERN="(https?://)?$VC_DEV_SERVER_HOST(/[A-Za-z0-9_./@+%~-]*)?"

# `.../:8081/assets/...` is a different animal: Metro bakes an asset's
# `httpServerLocation` with the default dev-server origin when a package ships
# an asset it cannot make relative. That asset will not load in production --
# worth saying -- but it is not evidence that the *bundle* is a dev bundle, so
# it warns while anything else fails. (A real, single instance of this in this
# template: an @expo-google-fonts/material-symbols font pulled in transitively.)
vc_dev_server_verdict() { # <bundle path>
  local hits code assets
  if [ ! -f "$1" ]; then
    printf 'FAIL no JS bundle at %s\n' "$1"
    return 0
  fi
  hits="$(LC_ALL=C grep -aoE "$VC_DEV_SERVER_PATTERN" "$1" | sort -u || true)"
  if [ -z "$hits" ]; then
    printf 'ok no dev-server URL in the bundle\n'
    return 0
  fi
  code="$(printf '%s\n' "$hits" | grep -vE ":8081/assets/" | cut -c1-90 | head -3 | paste -sd' ' - || true)"
  if [ -n "$code" ]; then
    printf 'FAIL bundle references a Metro dev server: %s\n' "$code"
    return 0
  fi
  assets="$(printf '%s\n' "$hits" | cut -c1-90 | head -2 | paste -sd' ' - || true)"
  printf 'warn asset(s) baked with a dev-server origin (they will not load in production): %s\n' "$assets"
}

# The first eight bytes of a Hermes bytecode file (`HermesBytecodeFileMagic`
# in hermes/BCGen/HBC/BytecodeFileFormat.h), little-endian.
VC_HERMES_MAGIC='c61fbc03c103191f'

vc_hermes_verdict() { # <bundle path>
  local magic
  if [ ! -f "$1" ]; then
    printf 'FAIL no JS bundle at %s\n' "$1"
    return 0
  fi
  magic="$(od -An -tx1 -N8 -- "$1" 2>/dev/null | tr -d ' \n')"
  if [ "$magic" = "$VC_HERMES_MAGIC" ]; then
    printf 'ok Hermes bytecode\n'
  elif [ -z "$magic" ]; then
    printf 'FAIL %s is empty or unreadable\n' "$1"
  else
    printf 'FAIL not Hermes bytecode (magic %s, expected %s)\n' "$magic" "$VC_HERMES_MAGIC"
  fi
}

# The EXPO_PUBLIC_* names .env.example documents. Expo inlines the *values*, so
# these names are only the list of things to look for.
vc_public_env_names() { # <.env.example content>
  printf '%s\n' "$1" | sed -n 's/^[[:space:]]*\(EXPO_PUBLIC_[A-Za-z0-9_]*\)=.*/\1/p' | sort -u || true
}

# For every EXPO_PUBLIC_* name that is set and non-empty *here*, its value has
# to be inlined in the bundle. Unset names are listed as skipped and never
# fail: a verify run on a machine without the release env is still useful.
vc_public_env_verdict() { # <bundle path> <.env.example content>
  local names name value found=() missing=() skipped=()
  names="$(vc_public_env_names "$2")"
  if [ -z "$names" ]; then
    printf 'skip no EXPO_PUBLIC_* names in .env.example\n'
    return 0
  fi
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    value="$(printenv "$name" || true)"
    if [ -z "$value" ]; then
      skipped+=("$name")
    elif LC_ALL=C grep -aqF -- "$value" "$1"; then
      found+=("$name")
    else
      missing+=("$name")
    fi
  done <<EOF
$names
EOF

  if [ "${#missing[@]}" -gt 0 ]; then
    printf 'FAIL value not inlined in the bundle: %s\n' "${missing[*]}"
  elif [ "${#found[@]}" -gt 0 ]; then
    printf 'ok inlined: %s (unset, skipped: %s)\n' "${found[*]}" "${skipped[*]:-none}"
  else
    printf 'skip none set in this environment: %s\n' "${skipped[*]}"
  fi
}

# OTA has to be on in the artifact exactly when the build was told to turn it
# on. `expected` empty means OTA_ENABLED was not in the environment at verify
# time, which is reported rather than guessed at.
vc_ota_verdict() { # <expected true|false|''> <actual true|false|absent>
  if [ -z "$1" ]; then
    printf 'skip OTA_ENABLED not set; artifact says updates enabled=%s\n' "$2"
  elif [ "$1" = "$2" ]; then
    printf 'ok updates enabled=%s, matching OTA_ENABLED\n' "$2"
  else
    printf 'FAIL OTA_ENABLED=%s but the artifact says updates enabled=%s\n' "$1" "$2"
  fi
}

vc_bool() { # <value> -> true | false | '' (empty in, empty out)
  case "$1" in
    '') printf '' ;;
    true | TRUE | True | 1 | yes) printf 'true' ;;
    *) printf 'false' ;;
  esac
}

# sha256 of certs/expo-updates-cert.pem as this template ships it. certs/README.md
# says it plainly: the matching private key was generated and then discarded, so
# the committed certificate can never verify a real manifest. Shipping OTA with
# it still in place is a warning, not a failure -- the wiring is correct, the
# trust chain is not.
VC_PLACEHOLDER_CERT_SHA256='08af4ad6ac07063185116ea03b10b266a796c0ae441c9e0a34d121d434d982f6'

vc_cert_placeholder_verdict() { # <sha256 of the pem>
  if [ "$1" = "$VC_PLACEHOLDER_CERT_SHA256" ]; then
    printf 'warn certs/expo-updates-cert.pem is still the template placeholder (its private key was discarded; see certs/README.md)\n'
  else
    printf 'ok code-signing certificate is not the template placeholder\n'
  fi
}

# Store metadata still carrying the template's prose. The hard gate lives in
# the fastlane `release_production` lanes (`assert_metadata_ready!`); here it is
# a warning, so a beta build is not blocked by copy nobody has written yet.
VC_METADATA_PLACEHOLDER='Replace this text'

vc_metadata_placeholder_verdict() { # <repo root>
  local dir="$1/fastlane/metadata" offenders
  if [ ! -d "$dir" ]; then
    printf 'skip no fastlane/metadata tree at %s\n' "$dir"
    return 0
  fi
  offenders="$(grep -rl "$VC_METADATA_PLACEHOLDER" "$dir" 2>/dev/null | sed "s#^$1/##" | sort | paste -sd' ' - || true)"
  if [ -n "$offenders" ]; then
    printf 'warn store metadata still has template placeholder text: %s\n' "$offenders"
  else
    printf 'ok no placeholder text in fastlane/metadata\n'
  fi
}

# apksigner prints `SHA-256: aa:bb:...`; a fingerprint pasted from the Play
# console has no colons and may be upper case. Compare the digits.
vc_normalize_sha() { # <fingerprint>
  printf '%s' "$1" | tr -d ': \n\t' | tr '[:upper:]' '[:lower:]'
}

vc_sha_verdict() { # <what> <expected> <actual>
  local want have
  want="$(vc_normalize_sha "$2")"
  have="$(vc_normalize_sha "$3")"
  if [ -z "$have" ]; then
    printf 'FAIL no %s SHA-256 to compare\n' "$1"
  elif [ "$want" = "$have" ]; then
    printf 'ok %s SHA-256 %s\n' "$1" "$have"
  else
    printf 'FAIL %s SHA-256 %s, expected %s\n' "$1" "$have" "$want"
  fi
}

vc_cert_verdict() { # <expected> <actual>
  vc_sha_verdict 'signing certificate' "$1" "$2"
}

# dwarfdump --uuid output, one `UUID: <uuid> (<arch>) <path>` line per slice.
vc_uuids() { # <dwarfdump --uuid output>
  printf '%s\n' "$1" | sed -n 's/^UUID: \([0-9A-Fa-f-]*\) .*/\1/p' | tr '[:lower:]' '[:upper:]' | sort -u || true
}

vc_dsym_verdict() { # <binary dwarfdump output> <dsym dwarfdump output>
  local bin dsym missing
  bin="$(vc_uuids "$1")"
  dsym="$(vc_uuids "$2")"
  if [ -z "$bin" ]; then
    printf 'FAIL no UUID in the app binary\n'
    return 0
  fi
  if [ -z "$dsym" ]; then
    printf 'FAIL no UUID in the dSYM\n'
    return 0
  fi
  missing="$(comm -23 <(printf '%s\n' "$bin") <(printf '%s\n' "$dsym") | paste -sd' ' - || true)"
  if [ -n "$missing" ]; then
    printf 'FAIL dSYM does not cover binary UUID(s): %s\n' "$missing"
  else
    printf 'ok dSYM covers %s\n' "$(printf '%s\n' "$bin" | paste -sd' ' - || true)"
  fi
}

# ---------------------------------------------------------------------------
# Tool discovery
# ---------------------------------------------------------------------------

# aapt2 / apksigner / zipalign are not on PATH on a normal machine; they live
# in the newest build-tools directory of the installed SDK.
vc_android_build_tool() { # <tool> -> prints an absolute path, or fails
  local tool="$1" sdk newest candidate
  if command -v "$tool" >/dev/null 2>&1; then
    command -v "$tool"
    return 0
  fi
  sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  [ -n "$sdk" ] && [ -d "$sdk/build-tools" ] || return 1
  newest="$(find "$sdk/build-tools" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort -V | tail -1 || true)"
  [ -n "$newest" ] || return 1
  candidate="$sdk/build-tools/$newest/$tool"
  [ -x "$candidate" ] || return 1
  printf '%s\n' "$candidate"
}

# bundletool is a jar on some machines and a wrapper script on others -- the
# same two shapes fastlane's `bundletool_command` accepts. Sets VC_BUNDLETOOL
# to the argv that runs it.
VC_BUNDLETOOL=()
vc_find_bundletool() {
  if command -v bundletool >/dev/null 2>&1; then
    VC_BUNDLETOOL=(bundletool)
    return 0
  fi
  if [ -n "${BUNDLETOOL_JAR:-}" ] && [ -f "$BUNDLETOOL_JAR" ] && command -v java >/dev/null 2>&1; then
    VC_BUNDLETOOL=(java -jar "$BUNDLETOOL_JAR")
    return 0
  fi
  # shellcheck disable=SC2034 # read by the scripts that source this file
  VC_BUNDLETOOL=()
  return 1
}
