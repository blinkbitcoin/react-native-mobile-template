#!/bin/bash
# Create the empty file tree that `deliver`/`supply` read metadata and
# screenshots from - iOS under fastlane/metadata/ios and
# fastlane/screenshots, Android under fastlane/metadata/android. Every
# created file is empty; it exists purely so it can be found, filled in,
# and picked up by check-metadata.sh. Existing files are never touched
# (re-running is idempotent) unless --force is given.
#
# Usage:
#   scaffold.sh [--locale en-US] [--platform ios|android|both] [--from-console] [--force]
#
# --from-console runs `bundle exec fastlane <platform> pull_metadata` first
# (the lane itself writes the tree - this does not merge anything) and then
# reports a diff of what changed. It does not skip the normal create-if-
# missing pass, so a hand-written file the pull didn't touch is still left
# alone.
#
# Category files (primary_category.txt etc.) are deliberately NOT created -
# see docs/release-runbook.md "Categories are console-only until you create
# the files."
#
# Exit codes: 0 ok, 2 not in a repo with fastlane/, 64 usage.

set -uo pipefail

die_usage() { echo "FATAL: $*" >&2; exit 64; }

LOCALE="en-US"
PLATFORM="both"
FROM_CONSOLE=0
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --locale)
      [ $# -ge 2 ] || die_usage "--locale needs a value"
      LOCALE="$2"
      shift 2
      ;;
    --platform)
      [ $# -ge 2 ] || die_usage "--platform needs a value"
      case "$2" in
        ios | android | both) : ;;
        *) die_usage "--platform must be ios, android or both" ;;
      esac
      PLATFORM="$2"
      shift 2
      ;;
    --from-console)
      FROM_CONSOLE=1
      shift
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

REPO_ROOT="${REPO_ROOT:-$(pwd)}"
FASTLANE_DIR="$REPO_ROOT/fastlane"
[ -d "$FASTLANE_DIR" ] || {
  echo "FATAL: no fastlane/ directory under $REPO_ROOT - run this from the app repo" >&2
  exit 2
}

if [ "$FROM_CONSOLE" -eq 1 ]; then
  run_pull() {
    local platform="$1"
    echo "== bundle exec fastlane $platform pull_metadata"
    (cd "$REPO_ROOT" && bundle exec fastlane "$platform" pull_metadata)
  }
  [ "$PLATFORM" = "android" ] || run_pull ios
  [ "$PLATFORM" = "ios" ] || run_pull android

  if command -v git >/dev/null 2>&1 && git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "== diff after pull_metadata"
    git -C "$REPO_ROOT" status --short -- fastlane/metadata fastlane/screenshots
  fi
fi

CREATED=0
create_file() {
  local rel="$1"
  local path="$FASTLANE_DIR/$rel"
  mkdir -p "$(dirname "$path")"
  if [ -f "$path" ] && [ "$FORCE" -ne 1 ]; then
    return 0
  fi
  : >"$path"
  CREATED=$((CREATED + 1))
}

scaffold_ios() {
  create_file "metadata/ios/copyright.txt"
  for name in name subtitle description keywords promotional_text release_notes support_url marketing_url privacy_url; do
    create_file "metadata/ios/$LOCALE/$name.txt"
  done
  for name in first_name last_name phone_number email_address demo_user demo_password notes; do
    create_file "metadata/ios/review_information/$name.txt"
  done
  create_file "screenshots/$LOCALE/.gitkeep"
}

scaffold_android() {
  for name in title short_description full_description video; do
    create_file "metadata/android/$LOCALE/$name.txt"
  done
  create_file "metadata/android/$LOCALE/changelogs/default.txt"
  create_file "metadata/android/$LOCALE/images/.gitkeep"
  create_file "metadata/android/images/phoneScreenshots/.gitkeep"
  create_file "metadata/android/images/sevenInchScreenshots/.gitkeep"
  create_file "metadata/android/images/tenInchScreenshots/.gitkeep"
}

[ "$PLATFORM" = "android" ] || scaffold_ios
[ "$PLATFORM" = "ios" ] || scaffold_android

echo "scaffolded $CREATED file(s) for locale $LOCALE (platform: $PLATFORM)"
echo "note: category files (primary_category.txt, secondary_category.txt) are console-only and were not created;" \
     "adding primary_category.txt also requires the four sub-category files" \
     "(primary_first_sub_category.txt, primary_second_sub_category.txt, secondary_first_sub_category.txt, secondary_second_sub_category.txt)"
exit 0
