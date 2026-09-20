#!/bin/bash
# Offline tests for the store-consoles skill: console-step.sh and the two
# reference files. No network, no real gh, no real console - gh is a shell
# fake on PATH, and REPO_ROOT/STORE_SETUP_DIR point at scratch directories
# under a temp dir.
#
#   ./tests/run.sh

set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$TESTS_DIR/.." && pwd)"
CONSOLE_STEP="$SKILL_DIR/scripts/console-step.sh"
SKILL_MD="$SKILL_DIR/SKILL.md"
APPLE_MD="$SKILL_DIR/references/apple.md"
GOOGLE_MD="$SKILL_DIR/references/google.md"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/store-consoles-tests.XXXXXX")"
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

# --- fakes -------------------------------------------------------------------
FAKEBIN="$WORK/fakebin"
mkdir -p "$FAKEBIN"
cat >"$FAKEBIN/gh" <<'FAKE_GH'
#!/bin/bash
if [ "$1" = "variable" ] && [ "$2" = "list" ]; then
  cat "${FAKE_GH_VARS:?FAKE_GH_VARS not set}"
  exit 0
fi
exit 1
FAKE_GH
chmod +x "$FAKEBIN/gh"
export PATH="$FAKEBIN:$PATH"

VARS_PLACEHOLDER="$WORK/vars-placeholder.json"
cat >"$VARS_PLACEHOLDER" <<'EOF'
[{"name":"IOS_BUNDLE_ID","value":"com.example.rnmt"}]
EOF

VARS_REAL="$WORK/vars-real.json"
cat >"$VARS_REAL" <<'EOF'
[{"name":"IOS_BUNDLE_ID","value":"com.acme.app"}]
EOF

# A scratch repo with no state and no `gh` reachable, so every resolution
# path (gh variable, fastlane metadata, package.json, state fact) falls back
# to "<ask the human>" cleanly rather than erroring.
export REPO_ROOT="$WORK/empty-repo"
mkdir -p "$REPO_ROOT"
export STORE_SETUP_DIR="$WORK/no-state"

# The exact 21-id vocabulary this skill covers, in order.
EXPECTED_IDS="apple-enrolment
apple-agreements
apple-bundle-id
apple-app-record
apple-asc-key
apple-match-repo
apple-testflight-groups
apple-privacy-labels
apple-pricing
google-account
google-app-record
google-play-app-signing
google-service-account
google-play-grant
google-tracks
google-store-listing-fields
google-content-rating
google-data-safety
google-target-audience
google-app-access
google-pricing"

echo
echo "console-step.sh --list"

check "--list matches the spec exactly, in order" "$EXPECTED_IDS" "$(FAKE_GH_VARS="$VARS_PLACEHOLDER" "$CONSOLE_STEP" --list)"

echo
echo "every id resolves with the required fields"

ALL_OK=1
while read -r id; do
  out=$(FAKE_GH_VARS="$VARS_PLACEHOLDER" "$CONSOLE_STEP" "$id" 2>&1) || { ALL_OK=0; break; }
  for field in "Console:" "URL:" "Click-path:" "Confirm:"; do
    printf '%s\n' "$out" | grep -q "^$field" || { ALL_OK=0; break 2; }
  done
done <<<"$EXPECTED_IDS"
check "every id from --list resolves with Console:/URL:/Click-path:/Confirm:" "yes" "$([ "$ALL_OK" -eq 1 ] && echo yes || echo no)"

echo
echo "reference headings match --list, both directions"

# shellcheck disable=SC2016 # the patterns are literal regexes, not shell expansions
HEADING_IDS="$(grep -ohE '^### `[a-z0-9-]+`' "$APPLE_MD" "$GOOGLE_MD" | sed -E 's/^### `//; s/`$//')"
check "every reference heading is in --list, and every --list id has a heading" "" \
  "$(diff <(printf '%s\n' "$EXPECTED_IDS") <(printf '%s\n' "$HEADING_IDS"))"

echo
echo "confirm classes"

CONFIRM_CLASSES="$(grep -ohE '^\*\*Confirm:\*\* [a-z]+' "$APPLE_MD" "$GOOGLE_MD" | sed -E 's/^\*\*Confirm:\*\* //' | sort -u)"
check "confirm classes are exactly safe|paid|binding|irreversible|permanent" \
  "binding
irreversible
paid
permanent
safe" "$CONFIRM_CLASSES"

NON_SAFE_IDS="$(
  for id in $EXPECTED_IDS; do
    cls="$(FAKE_GH_VARS="$VARS_PLACEHOLDER" "$CONSOLE_STEP" "$id" 2>/dev/null | sed -nE 's/^Confirm: ([a-z]+).*/\1/p')"
    [ "$cls" != "safe" ] && [ -n "$cls" ] && echo "$id"
  done
)"
check "the paid|binding|irreversible|permanent ids are exactly the spec set" \
  "apple-enrolment
apple-agreements
apple-bundle-id
apple-asc-key
google-account
google-play-app-signing
google-pricing" "$NON_SAFE_IDS"

check "google-app-record is safe, and says why in its own block" "yes" \
  "$(awk '/^### `google-app-record`/{f=1} f && /^### `/ && !/google-app-record/{exit} f' "$GOOGLE_MD" | grep -qi 'first upload' && echo yes || echo no)"

echo
echo "value resolution"

out=$(FAKE_GH_VARS="$VARS_PLACEHOLDER" "$CONSOLE_STEP" apple-bundle-id)
check "apple-bundle-id prints the fake gh variable value" "yes" \
  "$(printf '%s' "$out" | grep -qF 'com.example.rnmt' && echo yes || echo no)"
check "apple-bundle-id warns when the value is a template placeholder" "yes" \
  "$(printf '%s' "$out" | grep -q 'WARNING: identifiers gate would reject this value' && echo yes || echo no)"

out=$(FAKE_GH_VARS="$VARS_REAL" "$CONSOLE_STEP" apple-bundle-id)
check "apple-bundle-id does not warn on a real value" "no" \
  "$(printf '%s' "$out" | grep -q 'WARNING' && echo yes || echo no)"

out=$(FAKE_GH_VARS="$VARS_PLACEHOLDER" "$CONSOLE_STEP" google-play-grant)
check "google-play-grant asks the human when no fact is set" "yes" \
  "$(printf '%s' "$out" | grep -qF '<ask the human>' && echo yes || echo no)"

STORE_WITH_FACT="$WORK/store-with-fact"
mkdir -p "$STORE_WITH_FACT"
cat >"$STORE_WITH_FACT/state.json" <<'EOF'
{"schema":1,"mode":null,"steps":{},"facts":{"play_service_account_email":"svc@example-project.iam.gserviceaccount.com"}}
EOF
out=$(STORE_SETUP_DIR="$STORE_WITH_FACT" FAKE_GH_VARS="$VARS_PLACEHOLDER" "$CONSOLE_STEP" google-play-grant)
check "google-play-grant prints the fact's service account email" "yes" \
  "$(printf '%s' "$out" | grep -qF 'svc@example-project.iam.gserviceaccount.com' && echo yes || echo no)"

echo
echo "credential refusal under --format json"

out=$(FAKE_GH_VARS="$VARS_PLACEHOLDER" "$CONSOLE_STEP" google-app-access --format json 2>&1)
rc=$?
check "google-app-access --format json exits 2" "2" "$rc"
check "the refusal names a credential" "yes" "$(printf '%s' "$out" | grep -qi 'credential' && echo yes || echo no)"

out=$(FAKE_GH_VARS="$VARS_PLACEHOLDER" "$CONSOLE_STEP" apple-agreements --format json 2>&1)
check "apple-agreements --format json exits 2 too" "2" "$?"

out=$(FAKE_GH_VARS="$VARS_PLACEHOLDER" "$CONSOLE_STEP" google-app-access 2>&1)
check "google-app-access --format text still works" "0" "$?"

echo
echo "usage"

FAKE_GH_VARS="$VARS_PLACEHOLDER" "$CONSOLE_STEP" not-a-real-id >/dev/null 2>&1
check "an unknown id exits 64" "64" "$?"
FAKE_GH_VARS="$VARS_PLACEHOLDER" "$CONSOLE_STEP" >/dev/null 2>&1
check "no id given exits 64" "64" "$?"
FAKE_GH_VARS="$VARS_PLACEHOLDER" "$CONSOLE_STEP" apple-pricing --format xml >/dev/null 2>&1
check "an unknown --format exits 64" "64" "$?"

echo
echo "no credentials in the reference files"

check "neither reference file contains 'com.example'" "no" \
  "$(grep -ql 'com\.example' "$APPLE_MD" "$GOOGLE_MD" >/dev/null 2>&1 && echo yes || echo no)"
check "neither reference file contains a literal password value" "no" \
  "$(grep -qE '\bpassword: [^A-Za-z_<`]' "$APPLE_MD" "$GOOGLE_MD" >/dev/null 2>&1 && echo yes || echo no)"

echo
echo "SKILL.md"

check "SKILL.md loads claude-in-chrome before any browser tool" "yes" \
  "$(grep -qF 'claude-in-chrome' "$SKILL_MD" && grep -qi 'before any browser tool\|before touching any' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md names mode (a)" "yes" "$(grep -q '(a)' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md names mode (b)" "yes" "$(grep -q '(b)' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md names mode (c)" "yes" "$(grep -q '(c)' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md says the four questionnaires are mode (c) only" "yes" \
  "$(grep -qi 'mode (c) only' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md points at store-setup/references/modes.md" "yes" \
  "$(grep -qF 'store-setup/references/modes.md' "$SKILL_MD" && echo yes || echo no)"

echo
echo "-------------------------------------"
printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
