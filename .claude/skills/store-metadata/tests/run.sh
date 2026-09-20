#!/bin/bash
set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$TESTS_DIR/.." && pwd)"
REPO_ROOT_OF_TEMPLATE="$(cd "$SKILL_DIR/../../.." && pwd)"
FIXTURES_DIR="$TESTS_DIR/fixtures"

SCAFFOLD="$SKILL_DIR/scripts/scaffold.sh"
CHECK_METADATA="$SKILL_DIR/scripts/check-metadata.sh"
PLACE_IMAGES="$SKILL_DIR/scripts/place-images.sh"
AGE_RATING="$SKILL_DIR/scripts/age-rating.sh"
SYNC="$SKILL_DIR/scripts/sync.sh"
SKILL_MD="$SKILL_DIR/SKILL.md"

SHARED_RB="$REPO_ROOT_OF_TEMPLATE/fastlane/lanes/shared.rb"
AGE_RATING_GEM="$REPO_ROOT_OF_TEMPLATE/vendor/bundle/ruby/3.3.0/gems/fastlane-2.239.0/spaceship/lib/spaceship/connect_api/models/age_rating_declaration.rb"
APP_CATEGORY_GEM="$REPO_ROOT_OF_TEMPLATE/vendor/bundle/ruby/3.3.0/gems/fastlane-2.239.0/spaceship/lib/spaceship/connect_api/models/app_category.rb"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/store-metadata-tests.XXXXXX")"
PASS=0
FAIL=0
SKIP=0
trap 'rm -rf "$WORK"' EXIT

ok() {
  PASS=$((PASS + 1))
  printf '  \033[32mPASS\033[0m %s\n' "$1"
}
bad() {
  FAIL=$((FAIL + 1))
  printf '  \033[31mFAIL\033[0m %s\n       %s\n' "$1" "$2"
}
skip() {
  SKIP=$((SKIP + 1))
  printf '  \033[33mSKIP\033[0m %s\n' "$1"
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

FAKEBIN="$WORK/fakebin"
mkdir -p "$FAKEBIN"

# A fake `bundle` that records its argv and the two env vars sync.sh/scaffold.sh
# care about, and honours FAKE_FASTLANE_EXIT.
cat >"$FAKEBIN/bundle" <<'FAKE_BUNDLE'
{
  printf 'ARGV: %s\n' "$*"
  printf 'DRY_RUN=%s\n' "${DRY_RUN:-}"
  printf 'STORE_METADATA_SYNC_ENABLED=%s\n' "${STORE_METADATA_SYNC_ENABLED:-}"
} >>"${BUNDLE_LOG:?BUNDLE_LOG not set}"
exit "${FAKE_FASTLANE_EXIT:-0}"
FAKE_BUNDLE
chmod +x "$FAKEBIN/bundle"
export PATH="$FAKEBIN:$PATH"

BUNDLE_LOG="$WORK/bundle.log"
: >"$BUNDLE_LOG"
export BUNDLE_LOG

# --- image fixtures ----------------------------------------------------------
HAVE_IMAGE_TOOL=0
if command -v sips >/dev/null 2>&1 || command -v magick >/dev/null 2>&1 || command -v identify >/dev/null 2>&1; then
  HAVE_IMAGE_TOOL=1
fi

make_png() {
  # make_png <out> <width> <height>
  local out="$1" w="$2" h="$3"
  if command -v sips >/dev/null 2>&1; then
    # Start from a 1x1 PNG (smallest valid seed) and resize/pad with sips.
    local seed="$WORK/seed.png"
    if [ ! -f "$seed" ]; then
      node -e '
        const fs = require("fs");
        const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        fs.writeFileSync(process.argv[1], Buffer.from(b64, "base64"));
      ' "$seed"
    fi
    cp "$seed" "$out"
    sips -z "$h" "$w" "$out" >/dev/null 2>&1
  elif command -v magick >/dev/null 2>&1; then
    magick -size "${w}x${h}" xc:white "$out" >/dev/null 2>&1
  fi
}

# --- scaffold.sh ---------------------------------------------------------
echo "== scaffold.sh"

SCAFFOLD_WORK="$WORK/scaffold-empty"
mkdir -p "$SCAFFOLD_WORK/fastlane"
AFTER_LIST="$WORK/after.list"

out=$(REPO_ROOT="$SCAFFOLD_WORK" "$SCAFFOLD" 2>&1)
rc=$?
check "scaffold.sh on an empty fastlane/ exits 0" "0" "$rc"

EXPECTED_PATHS="$WORK/expected-scaffold-paths.txt"
cat >"$EXPECTED_PATHS" <<'EOF'
fastlane/metadata/ios/copyright.txt
fastlane/metadata/ios/en-US/name.txt
fastlane/metadata/ios/en-US/subtitle.txt
fastlane/metadata/ios/en-US/description.txt
fastlane/metadata/ios/en-US/keywords.txt
fastlane/metadata/ios/en-US/promotional_text.txt
fastlane/metadata/ios/en-US/release_notes.txt
fastlane/metadata/ios/en-US/support_url.txt
fastlane/metadata/ios/en-US/marketing_url.txt
fastlane/metadata/ios/en-US/privacy_url.txt
fastlane/metadata/ios/review_information/first_name.txt
fastlane/metadata/ios/review_information/last_name.txt
fastlane/metadata/ios/review_information/phone_number.txt
fastlane/metadata/ios/review_information/email_address.txt
fastlane/metadata/ios/review_information/demo_user.txt
fastlane/metadata/ios/review_information/demo_password.txt
fastlane/metadata/ios/review_information/notes.txt
fastlane/screenshots/en-US/.gitkeep
fastlane/metadata/android/en-US/title.txt
fastlane/metadata/android/en-US/short_description.txt
fastlane/metadata/android/en-US/full_description.txt
fastlane/metadata/android/en-US/video.txt
fastlane/metadata/android/en-US/changelogs/default.txt
fastlane/metadata/android/en-US/images/.gitkeep
fastlane/metadata/android/images/phoneScreenshots/.gitkeep
fastlane/metadata/android/images/sevenInchScreenshots/.gitkeep
fastlane/metadata/android/images/tenInchScreenshots/.gitkeep
EOF
sort "$EXPECTED_PATHS" >"$EXPECTED_PATHS.sorted"

(cd "$SCAFFOLD_WORK" && find fastlane -type f | sort) >"$AFTER_LIST"
check "scaffold.sh creates exactly the expected path set and nothing else" "" "$(diff "$EXPECTED_PATHS.sorted" "$AFTER_LIST")"

# re-running changes nothing
REPO_ROOT="$SCAFFOLD_WORK" "$SCAFFOLD" >/dev/null 2>&1
(cd "$SCAFFOLD_WORK" && find fastlane -type f | sort) >"$AFTER_LIST"
check "re-running scaffold.sh creates no new/removed files" "" "$(diff "$EXPECTED_PATHS.sorted" "$AFTER_LIST")"

# --from-console does not clobber a hand-written description
FROM_CONSOLE_WORK="$WORK/scaffold-from-console"
mkdir -p "$FROM_CONSOLE_WORK/fastlane"
REPO_ROOT="$FROM_CONSOLE_WORK" "$SCAFFOLD" >/dev/null 2>&1
printf 'My hand-written description.\n' >"$FROM_CONSOLE_WORK/fastlane/metadata/ios/en-US/description.txt"
: >"$BUNDLE_LOG"
out=$(REPO_ROOT="$FROM_CONSOLE_WORK" "$SCAFFOLD" --from-console 2>&1)
rc=$?
check "scaffold.sh --from-console exits 0" "0" "$rc"
check "scaffold.sh --from-console does not clobber a hand-written file" "My hand-written description." "$(cat "$FROM_CONSOLE_WORK/fastlane/metadata/ios/en-US/description.txt")"
check_contains "scaffold.sh --from-console runs the pull_metadata lanes" "pull_metadata" "$(cat "$BUNDLE_LOG")"

# exit 2 with no fastlane/
NOT_A_REPO="$WORK/not-a-repo"
mkdir -p "$NOT_A_REPO"
REPO_ROOT="$NOT_A_REPO" "$SCAFFOLD" >/dev/null 2>&1
check "scaffold.sh exits 2 with no fastlane/ directory" "2" "$?"

# category files are not scaffolded
check "scaffold.sh never creates primary_category.txt" "no" "$([ -f "$SCAFFOLD_WORK/fastlane/metadata/ios/primary_category.txt" ] && echo yes || echo no)"

echo
echo "== check-metadata.sh"

setup_metadata_tree() {
  local dest="$1"
  mkdir -p "$dest/fastlane/metadata"
  cp -R "$FIXTURES_DIR/metadata-tree/ios" "$dest/fastlane/metadata/ios"
  cp -R "$FIXTURES_DIR/metadata-tree/android" "$dest/fastlane/metadata/android"
}

FIXTURE_TREE="$WORK/fixture-tree"
setup_metadata_tree "$FIXTURE_TREE"
out=$(REPO_ROOT="$FIXTURE_TREE" "$CHECK_METADATA" --platform both 2>&1)
rc=$?
check "check-metadata.sh on the fixture exits 1" "1" "$rc"
check_contains "it reports the placeholder fault by path" "android/en-US/full_description.txt: contains the template placeholder text" "$out"
check_contains "it reports the over-limit name fault by path" "ios/en-US/name.txt: name is 41 characters" "$out"
check_contains "it reports the example.com privacy_url fault by path" "ios/en-US/privacy_url.txt: must not point at example.com" "$out"
check "check-metadata.sh reports exactly three faults" "3" "$(printf '%s\n' "$out" | grep -c ': ')"

CLEAN_TREE="$WORK/clean-tree"
setup_metadata_tree "$CLEAN_TREE"
printf 'Acme App\n' >"$CLEAN_TREE/fastlane/metadata/ios/en-US/name.txt"
printf 'https://acme.example/privacy\n' >"$CLEAN_TREE/fastlane/metadata/ios/en-US/privacy_url.txt"
printf 'A full description without placeholder text.\n' >"$CLEAN_TREE/fastlane/metadata/android/en-US/full_description.txt"
out=$(REPO_ROOT="$CLEAN_TREE" "$CHECK_METADATA" --platform both 2>&1)
rc=$?
check "check-metadata.sh on the fixed-up clean copy exits 0" "0" "$rc"

# length limits: at-limit pass, over-limit fail
LIMIT_TREE="$WORK/limit-tree"
setup_metadata_tree "$LIMIT_TREE"
printf 'https://acme.example/privacy\n' >"$LIMIT_TREE/fastlane/metadata/ios/en-US/privacy_url.txt"
printf 'A full description without placeholder text.\n' >"$LIMIT_TREE/fastlane/metadata/android/en-US/full_description.txt"
python3 -c "import sys; sys.stdout.write('A'*30)" >"$LIMIT_TREE/fastlane/metadata/ios/en-US/name.txt"
out=$(REPO_ROOT="$LIMIT_TREE" "$CHECK_METADATA" --platform ios 2>&1)
check_not_contains "a 30-character name (at the limit) passes" "name.txt" "$out"
python3 -c "import sys; sys.stdout.write('A'*31)" >"$LIMIT_TREE/fastlane/metadata/ios/en-US/name.txt"
out=$(REPO_ROOT="$LIMIT_TREE" "$CHECK_METADATA" --platform ios 2>&1)
check_contains "a 31-character name (over the limit) fails" "name.txt" "$out"

# keywords with ", " fails
KEYWORDS_TREE="$WORK/keywords-tree"
setup_metadata_tree "$KEYWORDS_TREE"
printf 'https://acme.example/privacy\n' >"$KEYWORDS_TREE/fastlane/metadata/ios/en-US/privacy_url.txt"
printf 'travel, food, fitness\n' >"$KEYWORDS_TREE/fastlane/metadata/ios/en-US/keywords.txt"
out=$(REPO_ROOT="$KEYWORDS_TREE" "$CHECK_METADATA" --platform ios 2>&1)
check_contains "keywords with ', ' fails" "keywords.txt" "$out"

# review_information partial/empty/full
REVIEW_TREE="$WORK/review-tree"
setup_metadata_tree "$REVIEW_TREE"
printf 'https://acme.example/privacy\n' >"$REVIEW_TREE/fastlane/metadata/ios/en-US/privacy_url.txt"
: >"$REVIEW_TREE/fastlane/metadata/ios/review_information/notes.txt"
out=$(REPO_ROOT="$REVIEW_TREE" "$CHECK_METADATA" --platform ios 2>&1)
check_contains "a partially-filled review_information fails" "review_information is partially filled" "$out"
for f in first_name last_name phone_number email_address demo_user demo_password notes; do
  : >"$REVIEW_TREE/fastlane/metadata/ios/review_information/$f.txt"
done
out=$(REPO_ROOT="$REVIEW_TREE" "$CHECK_METADATA" --platform ios 2>&1)
check_not_contains "an entirely-empty review_information passes" "review_information is partially filled" "$out"
for f in first_name last_name phone_number email_address demo_user demo_password notes; do
  printf 'value\n' >"$REVIEW_TREE/fastlane/metadata/ios/review_information/$f.txt"
done
out=$(REPO_ROOT="$REVIEW_TREE" "$CHECK_METADATA" --platform ios 2>&1)
check_not_contains "an entirely-full review_information passes" "review_information is partially filled" "$out"

# category ids
CATEGORY_TREE="$WORK/category-tree"
setup_metadata_tree "$CATEGORY_TREE"
printf 'https://acme.example/privacy\n' >"$CATEGORY_TREE/fastlane/metadata/ios/en-US/privacy_url.txt"
printf 'UTILITIES' >"$CATEGORY_TREE/fastlane/metadata/ios/primary_category.txt"
for sub in primary_first_sub_category primary_second_sub_category secondary_first_sub_category secondary_second_sub_category; do
  : >"$CATEGORY_TREE/fastlane/metadata/ios/$sub.txt"
done
out=$(REPO_ROOT="$CATEGORY_TREE" "$CHECK_METADATA" --platform ios 2>&1)
check_not_contains "category id UTILITIES passes" "primary_category.txt" "$out"
printf 'MZGenre.Utilities' >"$CATEGORY_TREE/fastlane/metadata/ios/primary_category.txt"
out=$(REPO_ROOT="$CATEGORY_TREE" "$CHECK_METADATA" --platform ios 2>&1)
check_contains "legacy id MZGenre.Utilities fails, suggesting the modern id" "UTILITIES" "$out"
printf 'Utilities' >"$CATEGORY_TREE/fastlane/metadata/ios/primary_category.txt"
out=$(REPO_ROOT="$CATEGORY_TREE" "$CHECK_METADATA" --platform ios 2>&1)
check_contains "legacy id Utilities fails too" "primary_category.txt" "$out"

echo
echo "== place-images.sh"

if [ "$HAVE_IMAGE_TOOL" -eq 1 ]; then
  IMG_1290x2796="$WORK/shot-1290x2796.png"
  IMG_1024x500="$WORK/feature-1024x500.png"
  IMG_512x512="$WORK/icon-512x512.png"
  IMG_800x600="$WORK/odd-800x600.png"
  make_png "$IMG_1290x2796" 1290 2796
  make_png "$IMG_1024x500" 1024 500
  make_png "$IMG_512x512" 512 512
  make_png "$IMG_800x600" 800 600

  PLACE_WORK="$WORK/place-images"
  mkdir -p "$PLACE_WORK/fastlane"

  out=$(REPO_ROOT="$PLACE_WORK" "$PLACE_IMAGES" --platform ios "$IMG_1290x2796" 2>&1)
  check "place-images.sh routes a 1290x2796 iOS shot to fastlane/screenshots/en-US/01_...png" "yes" \
    "$([ -f "$PLACE_WORK/fastlane/screenshots/en-US/01_shot-1290x2796.png" ] && echo yes || echo no)"

  out=$(REPO_ROOT="$PLACE_WORK" "$PLACE_IMAGES" --platform android "$IMG_1024x500" 2>&1)
  check "place-images.sh routes a 1024x500 image to images/featureGraphic.png" "yes" \
    "$([ -f "$PLACE_WORK/fastlane/metadata/android/images/featureGraphic.png" ] && echo yes || echo no)"

  out=$(REPO_ROOT="$PLACE_WORK" "$PLACE_IMAGES" --platform android "$IMG_512x512" 2>&1)
  check "place-images.sh routes a 512x512 image to images/icon.png" "yes" \
    "$([ -f "$PLACE_WORK/fastlane/metadata/android/images/icon.png" ] && echo yes || echo no)"

  out=$(REPO_ROOT="$PLACE_WORK" "$PLACE_IMAGES" --platform android "$IMG_800x600" 2>&1)
  rc=$?
  check "place-images.sh refuses an 800x600 image" "1" "$rc"
  check_contains "...naming the nearest legal size" "nearest legal size" "$out"

  DRYRUN_WORK="$WORK/place-images-dryrun"
  mkdir -p "$DRYRUN_WORK/fastlane"
  out=$(REPO_ROOT="$DRYRUN_WORK" "$PLACE_IMAGES" --platform ios --dry-run "$IMG_1290x2796" 2>&1)
  check "place-images.sh --dry-run copies nothing" "no" \
    "$([ -d "$DRYRUN_WORK/fastlane/screenshots" ] && echo yes || echo no)"

  FORCE_WORK="$WORK/place-images-force"
  mkdir -p "$FORCE_WORK/fastlane"
  REPO_ROOT="$FORCE_WORK" "$PLACE_IMAGES" --platform android "$IMG_512x512" >/dev/null 2>&1
  REPO_ROOT="$FORCE_WORK" "$PLACE_IMAGES" --platform android "$IMG_512x512" >/dev/null 2>&1
  rc=$?
  check "place-images.sh refuses an existing destination without --force" "2" "$rc"
  REPO_ROOT="$FORCE_WORK" "$PLACE_IMAGES" --platform android --force "$IMG_512x512" >/dev/null 2>&1
  check "place-images.sh --force overwrites an existing destination" "0" "$?"
else
  skip "place-images.sh image-dimension cases (no sips/magick/identify on PATH)"
fi

echo
echo "== age-rating.sh"

EXPECTED_AGE_KEYS="$WORK/expected-age-keys.txt"
ruby -e '
attrs = []
File.readlines(ARGV[0]).each do |line|
  m = line.match(/attr_accessor :(\w+)/)
  attrs << m[1] if m
end
omit = %w[developer_age_rating_info_url gambling_and_contests]
attrs.reject! { |a| omit.include?(a) }
attrs.each do |a|
  camel = a.split("_").each_with_index.map { |w, i| i == 0 ? w : w.capitalize }.join
  puts camel
end
' "$AGE_RATING_GEM" >"$EXPECTED_AGE_KEYS"

out=$("$AGE_RATING" --list-keys 2>&1)
check "age-rating.sh --list-keys matches the gem-derived key list" "" "$(diff <(sort "$EXPECTED_AGE_KEYS") <(printf '%s\n' "$out" | sort))"

AGE_WORK="$WORK/age-rating"
mkdir -p "$AGE_WORK"
out=$("$AGE_RATING" --out "$AGE_WORK/config.json" --set unknownKey=NONE 2>&1)
check "age-rating.sh --set with an unknown key exits 64" "64" "$?"

out=$("$AGE_RATING" --out "$AGE_WORK/config.json" --set advertising=maybe 2>&1)
check "age-rating.sh --set with a bad value exits 64" "64" "$?"

out=$("$AGE_RATING" --out "$AGE_WORK/config.json" --set advertising=true 2>&1)
rc=$?
check "age-rating.sh --set with an incomplete set exits 1" "1" "$rc"

FULL_ANSWERS="$AGE_WORK/answers.txt"
: >"$FULL_ANSWERS"
while IFS= read -r key; do
  case "$key" in
    ageRatingOverrideV2) value="NONE" ;;
    koreaAgeRatingOverride) value="NONE" ;;
    kidsAgeBand) value="null" ;;
    advertising | ageAssurance | gambling | healthOrWellnessTopics | lootBox | messagingAndChat | parentalControls | socialMedia | socialMediaAgeRestricted | unrestrictedWebAccess | userGeneratedContent) value="false" ;;
    *) value="NONE" ;;
  esac
  echo "$key=$value" >>"$FULL_ANSWERS"
done <"$EXPECTED_AGE_KEYS"

out=$("$AGE_RATING" --out "$AGE_WORK/config.json" --from-answers "$FULL_ANSWERS" 2>&1)
rc=$?
check "age-rating.sh --from-answers with a complete set exits 0" "0" "$rc"
check "the written JSON is valid" "0" "$(node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$AGE_WORK/config.json" >/dev/null 2>&1; echo $?)"
WRITTEN_KEYS="$(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))).sort().join('\n'))" "$AGE_WORK/config.json")"
SHIPPED_KEYS="$(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))).sort().join('\n'))" "$REPO_ROOT_OF_TEMPLATE/fastlane/metadata/ios/app_rating_config.json")"
check "the written key set equals the shipped file's key set" "$SHIPPED_KEYS" "$WRITTEN_KEYS"

echo
echo "== the placeholder literal and category/age lists match the repo"

SHARED_RB_LITERAL="$(sed -nE "s/^METADATA_PLACEHOLDER = '(.*)'$/\1/p" "$SHARED_RB")"
CHECK_METADATA_LITERAL="$(sed -nE "s/^PLACEHOLDER='(.*)'$/\1/p" "$CHECK_METADATA")"
check "check-metadata.sh's placeholder literal equals shared.rb's METADATA_PLACEHOLDER" "$SHARED_RB_LITERAL" "$CHECK_METADATA_LITERAL"

GEM_CATEGORY_IDS="$(grep -oE '"[A-Z_]+"' "$APP_CATEGORY_GEM" | tr -d '"' | sort -u)"
SCRIPT_CATEGORY_IDS="$(sed -nE 's/^CATEGORY_IDS="(.*)"$/\1/p' "$CHECK_METADATA" | tr ' ' '\n' | sort -u)"
check "check-metadata.sh's category id list equals the vendored app_category.rb ids" "" "$(diff <(printf '%s\n' "$GEM_CATEGORY_IDS") <(printf '%s\n' "$SCRIPT_CATEGORY_IDS"))"

echo
echo "== sync.sh"

SYNC_WORK="$WORK/sync"
setup_metadata_tree "$SYNC_WORK"
printf 'Acme App\n' >"$SYNC_WORK/fastlane/metadata/ios/en-US/name.txt"
printf 'https://acme.example/privacy\n' >"$SYNC_WORK/fastlane/metadata/ios/en-US/privacy_url.txt"
printf 'A full description without placeholder text.\n' >"$SYNC_WORK/fastlane/metadata/android/en-US/full_description.txt"

env -u STORE_METADATA_SYNC_ENABLED REPO_ROOT="$SYNC_WORK" "$SYNC" both --dry-run >/dev/null 2>&1
check "sync.sh exits 2 without STORE_METADATA_SYNC_ENABLED" "2" "$?"

BROKEN_SYNC_WORK="$WORK/sync-broken"
setup_metadata_tree "$BROKEN_SYNC_WORK"
out=$(STORE_METADATA_SYNC_ENABLED=true REPO_ROOT="$BROKEN_SYNC_WORK" "$SYNC" both --dry-run 2>&1)
rc=$?
check "sync.sh refuses when check-metadata.sh fails" "2" "$rc"
check_contains "...naming check-metadata.sh" "check-metadata.sh" "$out"

: >"$BUNDLE_LOG"
out=$(STORE_METADATA_SYNC_ENABLED=true REPO_ROOT="$SYNC_WORK" "$SYNC" both --dry-run 2>&1)
rc=$?
check "sync.sh --dry-run exits 0 against a clean tree" "0" "$rc"
check_contains "the fake bundle saw DRY_RUN=1" "DRY_RUN=1" "$(cat "$BUNDLE_LOG")"
check_contains "the fake bundle saw sync_metadata in argv" "sync_metadata" "$(cat "$BUNDLE_LOG")"

STORE_METADATA_SYNC_ENABLED=true REPO_ROOT="$SYNC_WORK" "$SYNC" both >/dev/null 2>&1
check "sync.sh without --yes on a real run exits 64" "64" "$?"

echo
echo "== SKILL.md"

check "SKILL.md names scaffold.sh" "yes" "$(grep -qF 'scaffold.sh' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md names check-metadata.sh" "yes" "$(grep -qF 'check-metadata.sh' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md names place-images.sh" "yes" "$(grep -qF 'place-images.sh' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md names age-rating.sh" "yes" "$(grep -qF 'age-rating.sh' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md names sync.sh" "yes" "$(grep -qF 'sync.sh' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md mentions the METADATA_PLACEHOLDER literal" "yes" "$(grep -qF 'Replace this text' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md mentions overwrite_screenshots" "yes" "$(grep -qF 'overwrite_screenshots' "$SKILL_MD" && echo yes || echo no)"
check "SKILL.md mentions STORE_METADATA_SYNC_ENABLED" "yes" "$(grep -qF 'STORE_METADATA_SYNC_ENABLED' "$SKILL_MD" && echo yes || echo no)"

echo
echo "-------------------------------------"
printf '%d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ] || exit 1
