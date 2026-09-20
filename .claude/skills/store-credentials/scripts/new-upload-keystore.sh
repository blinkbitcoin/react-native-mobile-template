#!/bin/bash
# Generate a new Android upload keystore. Refuses to write anywhere git
# would track (an upload keystore committed to history is unrecoverable —
# Play ties an app forever to the signing certificate inside it) and never
# prints a password to any output stream.
#
# Usage:
#   new-upload-keystore.sh --out <path> --alias <alias> [--dname <dn>] \
#     [--validity <days>] [--force]
#
#   ANDROID_UPLOAD_KEYSTORE_PASSWORD / ANDROID_UPLOAD_KEY_PASSWORD, if set,
#   are used as-is; otherwise each is generated with `openssl rand -base64
#   24` and written once to <out>.storepass / <out>.keypass (chmod 600,
#   never printed) for the human to move into a password manager and delete.
#
# On success prints exactly:
#   ANDROID_UPLOAD_KEY_ALIAS=<alias>
#   ANDROID_UPLOAD_CERT_SHA256=<colon-separated fingerprint>
#   ANDROID_UPLOAD_KEYSTORE_BASE64_FILE=<out>.b64
#
# Exit codes: 0 ok, 1 validation failed (bad --validity), 2 refused
# (ungitignored --out, or --out already exists without --force), 64 usage.

set -uo pipefail

die_usage() { echo "FATAL: $*" >&2; exit 64; }
die_validation() { echo "FATAL: $*" >&2; exit 1; }
die_refused() { echo "FATAL: $*" >&2; exit 2; }

OUT=""
ALIAS=""
DNAME="CN=Android Upload Key, O=App, C=US"
VALIDITY=10950
MIN_VALIDITY=9125
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --out)
      [ $# -ge 2 ] || die_usage "--out needs a path"
      OUT="$2"
      shift 2
      ;;
    --alias)
      [ $# -ge 2 ] || die_usage "--alias needs a value"
      ALIAS="$2"
      shift 2
      ;;
    --dname)
      [ $# -ge 2 ] || die_usage "--dname needs a value"
      DNAME="$2"
      shift 2
      ;;
    --validity)
      [ $# -ge 2 ] || die_usage "--validity needs a number of days"
      VALIDITY="$2"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    *)
      die_usage "unknown option '$1'"
      ;;
  esac
done

[ -n "$OUT" ] || die_usage "--out is required"
[ -n "$ALIAS" ] || die_usage "--alias is required"
command -v keytool >/dev/null 2>&1 || die_usage "keytool not on PATH (needs a JDK)"
[[ "$VALIDITY" =~ ^[0-9]+$ ]] || die_usage "--validity must be an integer number of days"
[ "$VALIDITY" -ge "$MIN_VALIDITY" ] ||
  die_validation "--validity $VALIDITY is below the minimum of $MIN_VALIDITY days (25 years)"

OUT_DIR="$(dirname "$OUT")"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
OUT="$OUT_DIR/$(basename "$OUT")"

REPO_ROOT_FOR_OUT="$(git -C "$OUT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$REPO_ROOT_FOR_OUT" ] || die_usage "--out ($OUT) is not inside a git repository"
git -C "$REPO_ROOT_FOR_OUT" check-ignore -q -- "$OUT" ||
  die_refused "--out ($OUT) is not covered by .gitignore - an upload keystore must never be committed"

[ ! -e "$OUT" ] || [ "$FORCE" -eq 1 ] ||
  die_refused "--out ($OUT) already exists - pass --force to overwrite"

STOREPASS="${ANDROID_UPLOAD_KEYSTORE_PASSWORD:-}"
KEYPASS="${ANDROID_UPLOAD_KEY_PASSWORD:-}"
GENERATED_NOTES=()

if [ -z "$STOREPASS" ]; then
  STOREPASS="$(openssl rand -base64 24)"
  STOREPASS_FILE="$OUT.storepass"
  (umask 077 && printf '%s\n' "$STOREPASS" >"$STOREPASS_FILE")
  GENERATED_NOTES+=("store password written to $STOREPASS_FILE")
fi
if [ -z "$KEYPASS" ]; then
  KEYPASS="$(openssl rand -base64 24)"
  KEYPASS_FILE="$OUT.keypass"
  (umask 077 && printf '%s\n' "$KEYPASS" >"$KEYPASS_FILE")
  GENERATED_NOTES+=("key password written to $KEYPASS_FILE")
fi

rm -f "$OUT"
if ! keytool -genkeypair -keyalg RSA -keysize 2048 -storetype JKS \
  -keystore "$OUT" -alias "$ALIAS" -storepass "$STOREPASS" -keypass "$KEYPASS" \
  -validity "$VALIDITY" -dname "$DNAME" >"$OUT_DIR/.new-upload-keystore.log" 2>&1; then
  echo "FATAL: keytool -genkeypair failed - see $OUT_DIR/.new-upload-keystore.log" >&2
  exit 1
fi
rm -f "$OUT_DIR/.new-upload-keystore.log"

LIST_OUT="$(keytool -list -v -keystore "$OUT" -alias "$ALIAS" -storepass "$STOREPASS" 2>/dev/null)"
SHA256="$(printf '%s\n' "$LIST_OUT" | sed -nE 's/^[[:space:]]*SHA256: (.*)$/\1/p' | head -1)"

BASE64_FILE="$OUT.b64"
(umask 077 && base64 -i "$OUT" >"$BASE64_FILE")

echo "ANDROID_UPLOAD_KEY_ALIAS=$ALIAS"
echo "ANDROID_UPLOAD_CERT_SHA256=$SHA256"
echo "ANDROID_UPLOAD_KEYSTORE_BASE64_FILE=$BASE64_FILE"

for note in "${GENERATED_NOTES[@]+"${GENERATED_NOTES[@]}"}"; do
  echo "NOTE: $note - move it to a password manager and delete the file" >&2
done
