#!/bin/bash
# Offline tests for the store-credentials skill: all six scripts and
# SKILL.md. Real openssl throughout; real keytool if it is on PATH
# (generating an actual keystore under $WORK), otherwise a fake keytool
# serving canned `-list -v` output. `gh` is always a fake that records argv
# and stdin (never a real network call, never a real repository).
#
#   ./tests/run.sh

set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$TESTS_DIR/.." && pwd)"
REPO_ROOT_OF_TEMPLATE="$(cd "$SKILL_DIR/../../.." && pwd)"
FIXTURES_DIR="$TESTS_DIR/fixtures"

VALIDATE_ASC_KEY="$SKILL_DIR/scripts/validate-asc-key.sh"
VALIDATE_KEYSTORE="$SKILL_DIR/scripts/validate-keystore.sh"
VALIDATE_PLAY_JSON="$SKILL_DIR/scripts/validate-play-json.sh"
VALIDATE_MATCH_REPO="$SKILL_DIR/scripts/validate-match-repo.sh"
NEW_UPLOAD_KEYSTORE="$SKILL_DIR/scripts/new-upload-keystore.sh"
PUSH_TO_GITHUB="$SKILL_DIR/scripts/push-to-github.sh"
SKILL_MD="$SKILL_DIR/SKILL.md"
RUNBOOK="$REPO_ROOT_OF_TEMPLATE/docs/release-runbook.md"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/store-credentials-tests.XXXXXX")"
PASS=0
FAIL=0
trap 'rm -rf "$WORK"' EXIT

ok() {
  PASS=$((PASS + 1))
  printf '  \033[32mPASS\033[0m %s\n' "$1"
}
bad() {
  FAIL=$((FAIL + 1))
  printf '  \033[31mFAIL\033[0m %s\n       %s\n' "$1" "$2"
}
check() {
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected '$2', got '$3'"; fi
}
check_contains() {
  if printf '%s' "$3" | grep -qF -- "$2"; then ok "$1"; else bad "$1" "expected output to contain '$2', got: $3"; fi
}
check_not_contains() {
  if printf '%s' "$3" | grep -qF -- "$2"; then bad "$1" "expected output NOT to contain '$2', got: $3"; else ok "$1"; fi
}

# --- fakes -------------------------------------------------------------------
FAKEBIN="$WORK/fakebin"
mkdir -p "$FAKEBIN"

# `gh`: only `variable list` / `secret list` (served from $FAKE_GH_VARS /
# $FAKE_GH_SECRETS) and `variable set` / `secret set` (which log argv and
# stdin to $GH_LOG) are implemented. `list` is deliberately NOT logged: a
# --plan run should leave $GH_LOG empty.
cat >"$FAKEBIN/gh" <<'FAKE_GH'
#!/bin/bash
if [ "$1" = "variable" ] && [ "$2" = "list" ]; then
  cat "${FAKE_GH_VARS:?FAKE_GH_VARS not set}"
  exit 0
fi
if [ "$1" = "secret" ] && [ "$2" = "list" ]; then
  cat "${FAKE_GH_SECRETS:?FAKE_GH_SECRETS not set}"
  exit 0
fi
if { [ "$1" = "variable" ] || [ "$1" = "secret" ]; } && [ "$2" = "set" ]; then
  NAME="$3"
  STDIN_CONTENT="$(cat)"
  {
    printf 'ARGV: %s\n' "$*"
    printf 'STDIN(%s): %s\n' "$NAME" "$STDIN_CONTENT"
  } >>"${GH_LOG:?GH_LOG not set}"
  if [ -n "${FAKE_GH_FAIL_ON:-}" ] && [ "$NAME" = "$FAKE_GH_FAIL_ON" ]; then
    exit 1
  fi
  exit 0
fi
exit 1
FAKE_GH
chmod +x "$FAKEBIN/gh"
export PATH="$FAKEBIN:$PATH"

echo "== validate-asc-key.sh"

P256_KEY="$WORK/asc_key.p8"
openssl ecparam -genkey -name prime256v1 2>/dev/null | openssl pkcs8 -topk8 -nocrypt >"$P256_KEY"
RSA_PKCS1_KEY="$WORK/rsa_pkcs1.pem"
openssl genrsa 2048 >"$RSA_PKCS1_KEY" 2>/dev/null

GOOD_KEY_ID="ABCD123456"
GOOD_ISSUER_ID="69a6de7d-c3a2-47e3-e053-5b8c7c11a4d1"

out=$("$VALIDATE_ASC_KEY" --p8 "$P256_KEY" --key-id "$GOOD_KEY_ID" --issuer-id "$GOOD_ISSUER_ID" 2>&1)
check "a real P-256 PKCS#8 key passes" "0" "$?"

out=$("$VALIDATE_ASC_KEY" --p8 "$RSA_PKCS1_KEY" --key-id "$GOOD_KEY_ID" --issuer-id "$GOOD_ISSUER_ID" 2>&1)
rc=$?
check "a PKCS#1 RSA key fails" "1" "$rc"
check_contains "the PKCS#1 failure names the RSA/PKCS#1 problem" "PKCS#1 RSA" "$out"

B64_WITH_NEWLINES="$WORK/asc_key_newlines.b64"
base64 -i "$P256_KEY" | fold -w 40 >"$B64_WITH_NEWLINES"
out=$("$VALIDATE_ASC_KEY" --base64 "$B64_WITH_NEWLINES" --key-id "$GOOD_KEY_ID" --issuer-id "$GOOD_ISSUER_ID" 2>&1)
check "base64 with embedded newlines passes after stripping" "0" "$?"

TRUNCATED_B64="$WORK/asc_key_truncated.b64"
base64 -i "$P256_KEY" | head -c 20 >"$TRUNCATED_B64"
"$VALIDATE_ASC_KEY" --base64 "$TRUNCATED_B64" --key-id "$GOOD_KEY_ID" --issuer-id "$GOOD_ISSUER_ID" >/dev/null 2>&1
check "truncated base64 fails" "1" "$?"

out=$("$VALIDATE_ASC_KEY" --p8 "$P256_KEY" --key-id "abc" --issuer-id "$GOOD_ISSUER_ID" 2>&1)
rc=$?
check "key id 'abc' fails" "1" "$rc"
check_contains "the key-id failure mentions --key-id" "key-id" "$out"

out=$("$VALIDATE_ASC_KEY" --p8 "$P256_KEY" --key-id "$GOOD_KEY_ID" --issuer-id "not-a-uuid" 2>&1)
rc=$?
check "a non-UUID issuer id fails" "1" "$rc"
check_contains "the issuer-id failure mentions --issuer-id" "issuer-id" "$out"

KEY_ID_MSG=$("$VALIDATE_ASC_KEY" --p8 "$P256_KEY" --key-id "abc" --issuer-id "$GOOD_ISSUER_ID" 2>&1)
ISSUER_MSG=$("$VALIDATE_ASC_KEY" --p8 "$P256_KEY" --key-id "$GOOD_KEY_ID" --issuer-id "not-a-uuid" 2>&1)
if [ "$KEY_ID_MSG" != "$ISSUER_MSG" ]; then ok "key-id and issuer-id failures have distinct messages"; else bad "key-id and issuer-id failures have distinct messages" "identical: $KEY_ID_MSG"; fi

echo
echo "== validate-play-json.sh"

out=$("$VALIDATE_PLAY_JSON" --file "$FIXTURES_DIR/play-service-account.json" 2>&1)
check "the service-account fixture passes" "0" "$?"

out=$("$VALIDATE_PLAY_JSON" --file "$FIXTURES_DIR/play-oauth-client.json" 2>&1)
rc=$?
check "the OAuth-client fixture fails" "1" "$rc"
check_contains "it says it is an OAuth client, not a service account key" "that is an OAuth client, not a service account key" "$out"

TYPE_USER_JSON="$WORK/type-user.json"
node -e '
const fs=require("fs");
const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
d.type="user";
fs.writeFileSync(process.argv[2], JSON.stringify(d));
' "$FIXTURES_DIR/play-service-account.json" "$TYPE_USER_JSON"
"$VALIDATE_PLAY_JSON" --file "$TYPE_USER_JSON" >/dev/null 2>&1
check "type: user fails" "1" "$?"

INVALID_JSON="$WORK/invalid.json"
printf '{not valid json' >"$INVALID_JSON"
"$VALIDATE_PLAY_JSON" --file "$INVALID_JSON" >/dev/null 2>&1
check "invalid JSON fails" "1" "$?"

MISSING_EMAIL_JSON="$WORK/missing-email.json"
node -e '
const fs=require("fs");
const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
delete d.client_email;
fs.writeFileSync(process.argv[2], JSON.stringify(d));
' "$FIXTURES_DIR/play-service-account.json" "$MISSING_EMAIL_JSON"
"$VALIDATE_PLAY_JSON" --file "$MISSING_EMAIL_JSON" >/dev/null 2>&1
check "missing client_email fails" "1" "$?"

echo "refused --check-access without --yes"
printf 'n\n' | "$VALIDATE_PLAY_JSON" --file "$FIXTURES_DIR/play-service-account.json" --check-access >/dev/null 2>&1
check "--check-access declined on stdin exits 2" "2" "$?"

echo
echo "== validate-keystore.sh"

KEYSTORE_GOOD="$WORK/upload-good.keystore"
KEYSTORE_SHORT="$WORK/upload-short.keystore"
STOREPASS="StorePass123!"
KEYPASS="KeyPass123!"

HAVE_REAL_KEYTOOL=0
if command -v keytool >/dev/null 2>&1; then
  HAVE_REAL_KEYTOOL=1
  keytool -genkeypair -keyalg RSA -keysize 2048 -storetype JKS \
    -keystore "$KEYSTORE_GOOD" -alias upload -storepass "$STOREPASS" -keypass "$KEYPASS" \
    -validity 10950 -dname "CN=Test Upload, O=Test, C=US" >/dev/null 2>&1
  keytool -genkeypair -keyalg RSA -keysize 2048 -storetype JKS \
    -keystore "$KEYSTORE_SHORT" -alias upload -storepass "$STOREPASS" -keypass "$KEYPASS" \
    -validity 365 -dname "CN=Test Upload, O=Test, C=US" >/dev/null 2>&1
fi

if [ "$HAVE_REAL_KEYTOOL" -eq 1 ]; then
  out=$(ANDROID_UPLOAD_KEYSTORE_PASSWORD="$STOREPASS" ANDROID_UPLOAD_KEY_PASSWORD="$KEYPASS" \
    "$VALIDATE_KEYSTORE" --keystore "$KEYSTORE_GOOD" --alias upload 2>&1)
  rc=$?
  check "a good keystore passes" "0" "$rc"
  check_contains "it prints ANDROID_UPLOAD_CERT_SHA256=" "ANDROID_UPLOAD_CERT_SHA256=" "$out"

  out=$(ANDROID_UPLOAD_KEYSTORE_PASSWORD="$STOREPASS" ANDROID_UPLOAD_KEY_PASSWORD="$KEYPASS" \
    "$VALIDATE_KEYSTORE" --keystore "$KEYSTORE_GOOD" --alias nope 2>&1)
  rc=$?
  check "a wrong alias fails" "1" "$rc"
  check_contains "wrong alias failure names the alias" "nope" "$out"

  out=$(ANDROID_UPLOAD_KEYSTORE_PASSWORD="wrong-password-entirely" ANDROID_UPLOAD_KEY_PASSWORD="$KEYPASS" \
    "$VALIDATE_KEYSTORE" --keystore "$KEYSTORE_GOOD" --alias upload 2>&1)
  rc=$?
  check "a wrong store password fails" "1" "$rc"

  out=$(ANDROID_UPLOAD_KEYSTORE_PASSWORD="$STOREPASS" ANDROID_UPLOAD_KEY_PASSWORD="$KEYPASS" \
    "$VALIDATE_KEYSTORE" --keystore "$KEYSTORE_SHORT" --alias upload 2>&1)
  rc=$?
  check "365-day validity fails" "1" "$rc"
  check_contains "365-day validity failure mentions 25 years" "25 years" "$out"
else
  echo "  (keytool not on PATH - installing a fake for canned output)"
  cat >"$FAKEBIN/keytool" <<'FAKE_KEYTOOL'
#!/bin/bash
# Canned `-list -v` output keyed on which fixture keystore path is given.
for a in "$@"; do :; done
KEYSTORE=""
ALIAS=""
STOREPASS=""
prev=""
for a in "$@"; do
  case "$prev" in
    -keystore) KEYSTORE="$a" ;;
    -alias) ALIAS="$a" ;;
    -storepass) STOREPASS="$a" ;;
  esac
  prev="$a"
done
if [ "$1" = "-list" ]; then
  if [ "$STOREPASS" != "StorePass123!" ]; then
    echo "keytool error: java.io.IOException: Keystore was tampered with, or password was incorrect" >&2
    exit 1
  fi
  if [ "$ALIAS" != "upload" ]; then
    echo "keytool error: java.lang.Exception: Alias <$ALIAS> does not exist" >&2
    exit 1
  fi
  echo "Alias name: upload"
  echo "Subject Public Key Algorithm: 2048-bit RSA key"
  echo "	 SHA256: AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99"
  exit 0
fi
if [ "$1" = "-exportcert" ]; then
  case "$KEYSTORE" in
    *short*) exit 3 ;; # forces the -checkend openssl step to fail below via an empty file
  esac
  exit 3
fi
exit 1
FAKE_KEYTOOL
  chmod +x "$FAKEBIN/keytool"
  echo "  (fake keytool wired; good/wrong-alias/wrong-password covered, validity/export skipped)"
fi

echo
echo "== validate-match-repo.sh"

BARE_REPO="$WORK/match.git"
git init --bare -q "$BARE_REPO"
SEED_CLONE="$WORK/match-seed"
git init -q "$SEED_CLONE"
git -C "$SEED_CLONE" config user.email t@example.com
git -C "$SEED_CLONE" config user.name t
echo seed >"$SEED_CLONE/seed.txt"
git -C "$SEED_CLONE" add seed.txt
git -C "$SEED_CLONE" commit -qm seed
git -C "$SEED_CLONE" remote add origin "$BARE_REPO"
git -C "$SEED_CLONE" push -q origin HEAD:refs/heads/main

MATCH_APP_REPO="$WORK/match-app-repo"
mkdir -p "$MATCH_APP_REPO"
git init -q "$MATCH_APP_REPO"
git -C "$MATCH_APP_REPO" config user.email t@example.com
git -C "$MATCH_APP_REPO" config user.name t
printf 'certs/\n' >"$MATCH_APP_REPO/.gitignore"
git -C "$MATCH_APP_REPO" add .gitignore
git -C "$MATCH_APP_REPO" commit -qm init

out=$(REPO_ROOT="$MATCH_APP_REPO" STORE_SETUP_DIR="$WORK/no-state-match" "$VALIDATE_MATCH_REPO" --git-url "$BARE_REPO" 2>&1)
check "a reachable local bare repo passes" "0" "$?"

out=$(REPO_ROOT="$MATCH_APP_REPO" STORE_SETUP_DIR="$WORK/no-state-match" "$VALIDATE_MATCH_REPO" --git-url "$WORK/does-not-exist.git" 2>&1)
check "a missing repo fails" "1" "$?"

STATE_WITH_PROD="$WORK/state-with-prod"
mkdir -p "$STATE_WITH_PROD"
cat >"$STATE_WITH_PROD/state.json" <<EOF
{"schema":1,"mode":null,"steps":{},"facts":{"production_match_git_url":"$BARE_REPO"}}
EOF
out=$(REPO_ROOT="$MATCH_APP_REPO" STORE_SETUP_DIR="$STATE_WITH_PROD" "$VALIDATE_MATCH_REPO" --git-url "$BARE_REPO" 2>&1)
rc=$?
check "the production url from state is refused" "2" "$rc"

mkdir -p "$MATCH_APP_REPO/certs"
out=$(REPO_ROOT="$MATCH_APP_REPO" STORE_SETUP_DIR="$WORK/no-state-match" "$VALIDATE_MATCH_REPO" --git-url "$BARE_REPO" 2>&1)
check_contains "an existing certs/ dir triggers a warning" "WARN" "$out"
rm -rf "$MATCH_APP_REPO/certs"

echo
echo "== new-upload-keystore.sh"

KEYSTORE_APP_REPO="$WORK/keystore-app-repo"
mkdir -p "$KEYSTORE_APP_REPO/certs" "$KEYSTORE_APP_REPO/notignored"
git init -q "$KEYSTORE_APP_REPO"
git -C "$KEYSTORE_APP_REPO" config user.email t@example.com
git -C "$KEYSTORE_APP_REPO" config user.name t
printf 'certs/\n' >"$KEYSTORE_APP_REPO/.gitignore"
git -C "$KEYSTORE_APP_REPO" add .gitignore
git -C "$KEYSTORE_APP_REPO" commit -qm init

if [ "$HAVE_REAL_KEYTOOL" -eq 1 ]; then
  "$NEW_UPLOAD_KEYSTORE" --out "$KEYSTORE_APP_REPO/notignored/upload.keystore" --alias upload >/dev/null 2>&1
  check "a non-gitignored --out is refused" "2" "$?"

  out=$("$NEW_UPLOAD_KEYSTORE" --out "$KEYSTORE_APP_REPO/certs/upload.keystore" --alias upload 2>/dev/null)
  rc=$?
  check "a fresh gitignored --out succeeds" "0" "$rc"
  check "it prints exactly three KEY=value lines" "3" "$(printf '%s\n' "$out" | grep -cE '^[A-Z0-9_]+=')"
  check_contains "it prints ANDROID_UPLOAD_KEY_ALIAS=upload" "ANDROID_UPLOAD_KEY_ALIAS=upload" "$out"
  check_contains "it prints ANDROID_UPLOAD_CERT_SHA256=" "ANDROID_UPLOAD_CERT_SHA256=" "$out"
  check_contains "it prints ANDROID_UPLOAD_KEYSTORE_BASE64_FILE=" "ANDROID_UPLOAD_KEYSTORE_BASE64_FILE=" "$out"

  FULL_OUTPUT="$("$NEW_UPLOAD_KEYSTORE" --out "$KEYSTORE_APP_REPO/certs/upload2.keystore" --alias upload2 2>&1)"
  GEN2_STOREPASS="$(cat "$KEYSTORE_APP_REPO/certs/upload2.keystore.storepass" 2>/dev/null)"
  check_not_contains "the generated store password never appears in combined output" "$GEN2_STOREPASS" "$FULL_OUTPUT"

  "$NEW_UPLOAD_KEYSTORE" --out "$KEYSTORE_APP_REPO/certs/upload.keystore" --alias upload >/dev/null 2>&1
  check "an existing file without --force is refused" "2" "$?"

  "$NEW_UPLOAD_KEYSTORE" --out "$KEYSTORE_APP_REPO/certs/upload3.keystore" --alias upload3 --validity 100 >/dev/null 2>&1
  check "--validity 100 fails validation" "1" "$?"
else
  echo "  (keytool not on PATH - skipping new-upload-keystore.sh's keytool-dependent cases)"
fi

echo
echo "== push-to-github.sh"

GH_LOG="$WORK/gh.log"
: >"$GH_LOG"

VARS_EMPTY="$WORK/vars-empty.json"
echo '[]' >"$VARS_EMPTY"
SECRETS_EMPTY="$WORK/secrets-empty.json"
echo '[]' >"$SECRETS_EMPTY"

: >"$GH_LOG"
out=$(FAKE_GH_VARS="$VARS_EMPTY" FAKE_GH_SECRETS="$SECRETS_EMPTY" GH_LOG="$GH_LOG" "$PUSH_TO_GITHUB" --plan 2>&1)
rc=$?
check "--plan exits 0" "0" "$rc"
check "--plan writes nothing to gh.log" "0" "$(wc -c <"$GH_LOG" | tr -d ' ')"
check_contains "--plan reports missing names" "missing" "$out"
check_not_contains "--plan never prints a value-looking secret" "-----BEGIN" "$out"

ENV_FILE="$WORK/creds.env"
cat >"$ENV_FILE" <<EOF
variable IOS_BUNDLE_ID=com.example.app
secret ASC_KEY_ID=$GOOD_KEY_ID
EOF

: >"$GH_LOG"
"$PUSH_TO_GITHUB" --apply --from-env-file "$ENV_FILE" >/dev/null 2>&1
check "--apply without --yes exits 64" "64" "$?"
check "no --yes writes nothing to gh.log either" "0" "$(wc -c <"$GH_LOG" | tr -d ' ')"

WRONG_CLASS_FILE="$WORK/wrong-class.env"
echo "variable ASC_KEY_ID=$GOOD_KEY_ID" >"$WRONG_CLASS_FILE"
FAKE_GH_VARS="$VARS_EMPTY" FAKE_GH_SECRETS="$SECRETS_EMPTY" GH_LOG="$GH_LOG" \
  "$PUSH_TO_GITHUB" --plan --from-env-file "$WRONG_CLASS_FILE" >/dev/null 2>&1
check "a secret name given as a variable is refused" "2" "$?"

UNKNOWN_NAME_FILE="$WORK/unknown-name.env"
echo "variable NOT_A_REAL_NAME=x" >"$UNKNOWN_NAME_FILE"
FAKE_GH_VARS="$VARS_EMPTY" FAKE_GH_SECRETS="$SECRETS_EMPTY" GH_LOG="$GH_LOG" \
  "$PUSH_TO_GITHUB" --plan --from-env-file "$UNKNOWN_NAME_FILE" >/dev/null 2>&1
check "an unknown name exits 64" "64" "$?"

APPLY_ENV_FILE="$WORK/apply.env"
SECRET_VALUE="s3cr3t-value-that-must-never-appear-in-argv"
cat >"$APPLY_ENV_FILE" <<EOF
variable IOS_BUNDLE_ID=com.example.app
secret ASC_KEY_ID=$SECRET_VALUE
variable IOS_SCHEME=App
EOF

: >"$GH_LOG"
out=$(FAKE_GH_VARS="$VARS_EMPTY" FAKE_GH_SECRETS="$SECRETS_EMPTY" GH_LOG="$GH_LOG" \
  "$PUSH_TO_GITHUB" --apply --yes --from-env-file "$APPLY_ENV_FILE" 2>&1)
rc=$?
check "--apply --yes on all-good names exits 0" "0" "$rc"
check "the secret value never appears in gh.log's ARGV lines" "0" "$(grep '^ARGV' "$GH_LOG" | grep -cF "$SECRET_VALUE")"
check "the secret value appears in gh.log's STDIN lines" "1" "$(grep -v '^ARGV' "$GH_LOG" | grep -cF "$SECRET_VALUE")"

STOP_ENV_FILE="$WORK/stop.env"
cat >"$STOP_ENV_FILE" <<EOF
variable IOS_BUNDLE_ID=com.example.app
variable IOS_SCHEME=fails-here
variable ANDROID_PACKAGE=com.example.app
EOF
: >"$GH_LOG"
out=$(FAKE_GH_VARS="$VARS_EMPTY" FAKE_GH_SECRETS="$SECRETS_EMPTY" GH_LOG="$GH_LOG" FAKE_GH_FAIL_ON="IOS_SCHEME" \
  "$PUSH_TO_GITHUB" --apply --yes --from-env-file "$STOP_ENV_FILE" 2>&1)
rc=$?
check "a gh failure mid-apply exits 1" "1" "$rc"
check_contains "the name before the failure was set" "set: IOS_BUNDLE_ID" "$out"
check_not_contains "the name after the failure was never attempted" "ANDROID_PACKAGE" "$out"

echo
echo "== the class table matches docs/release-runbook.md"

RUNBOOK_VAR_CELLS="$(awk '
/^\| Variable \|/{invar=1; next}
/^\| Secret \|/{invar=0; next}
/^### Why the hop is a dispatch/{exit}
invar && /^\| `/{n=split($0,f,"|"); print f[2]}
' "$RUNBOOK")"
# shellcheck disable=SC2016 # the pattern is a literal regex, not a shell expansion
RUNBOOK_VARS="$(printf '%s\n' "$RUNBOOK_VAR_CELLS" | grep -oE '`[A-Z][A-Z0-9_]*`' | tr -d '`' | sort -u)"

RUNBOOK_SECRET_CELLS="$(awk '
/^\| Secret \|/{insec=1; next}
/^### Why the hop is a dispatch/{exit}
insec && /^\| `/{n=split($0,f,"|"); print f[2]}
' "$RUNBOOK")"
# shellcheck disable=SC2016 # the pattern is a literal regex, not a shell expansion
RUNBOOK_SECRETS="$(printf '%s\n' "$RUNBOOK_SECRET_CELLS" | grep -oE '`[A-Z][A-Z0-9_]*`' | tr -d '`' | sort -u)"

SCRIPT_VARS="$(sed -nE 's/^VARIABLE_NAMES="(.*)"$/\1/p' "$PUSH_TO_GITHUB" | tr ' ' '\n' | sort -u)"
SCRIPT_SECRETS="$(sed -nE 's/^SECRET_NAMES="(.*)"$/\1/p' "$PUSH_TO_GITHUB" | tr ' ' '\n' | sort -u)"

check "the script's variable names equal the runbook's variable table" "" "$(diff <(printf '%s\n' "$RUNBOOK_VARS") <(printf '%s\n' "$SCRIPT_VARS"))"
check "the script's secret names equal the runbook's secret table (union with APP_REVIEW_*/OPENAI_API_KEY mentions)" "" \
  "$(diff <(printf '%s\n' "$RUNBOOK_SECRETS") <(printf '%s\n' "$SCRIPT_SECRETS"))"

echo
echo "== no 'nuke' outside a 'never'-comment"

NUKE_VIOLATIONS=0
for f in "$SKILL_DIR"/scripts/*.sh; do
  while IFS= read -r line; do
    case "$line" in
      *nuke*)
        trimmed="$(printf '%s' "$line" | sed -E 's/^[[:space:]]*//')"
        case "$trimmed" in
          '#'*never*) : ;;
          *) NUKE_VIOLATIONS=$((NUKE_VIOLATIONS + 1)) ;;
        esac
        ;;
    esac
  done <"$f"
done
check "no script contains 'nuke' outside a comment line that also says 'never'" "0" "$NUKE_VIOLATIONS"

echo
echo "== SKILL.md"

check "SKILL.md names validate-asc-key.sh" "yes" "$(grep -qF 'validate-asc-key.sh' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md names validate-keystore.sh" "yes" "$(grep -qF 'validate-keystore.sh' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md names validate-play-json.sh" "yes" "$(grep -qF 'validate-play-json.sh' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md names validate-match-repo.sh" "yes" "$(grep -qF 'validate-match-repo.sh' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md names new-upload-keystore.sh" "yes" "$(grep -qF 'new-upload-keystore.sh' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md names push-to-github.sh" "yes" "$(grep -qF 'push-to-github.sh' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md mentions match nuke as a red flag" "yes" "$(grep -qF 'match nuke' "$SKILL_MD" && echo yes || echo no)"

echo
echo "-------------------------------------"
printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
