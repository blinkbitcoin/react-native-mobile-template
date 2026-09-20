#!/bin/bash
# Copy a screenshot/icon/feature-graphic file into the right place under
# fastlane/, choosing the destination from the file's pixel dimensions.
# Never moves the source.
#
# Usage:
#   place-images.sh --platform ios|android [--locale en-US] [--kind screenshot|icon|feature] [--force] [--dry-run] <file>...
#
# Exit codes: 0 ok, 1 an unrecognised size, 2 destination exists without
# --force, 64 usage.

set -uo pipefail

die_usage() { echo "FATAL: $*" >&2; exit 64; }

IOS_SCREENSHOT_SIZES="1290x2796 2796x1290 1284x2778 1242x2688 1179x2556 1170x2532 1125x2436 1080x1920 2048x2732 2732x2048 1668x2388 2064x2752"
ALL_KNOWN_SIZES="$IOS_SCREENSHOT_SIZES 1024x500 512x512"

PLATFORM=""
LOCALE="en-US"
KIND=""
FORCE=0
DRY_RUN=0
FILES=()

while [ $# -gt 0 ]; do
  case "$1" in
    --platform)
      [ $# -ge 2 ] || die_usage "--platform needs a value"
      case "$2" in
        ios | android) : ;;
        *) die_usage "--platform must be ios or android" ;;
      esac
      PLATFORM="$2"
      shift 2
      ;;
    --locale)
      [ $# -ge 2 ] || die_usage "--locale needs a value"
      LOCALE="$2"
      shift 2
      ;;
    --kind)
      [ $# -ge 2 ] || die_usage "--kind needs a value"
      case "$2" in
        screenshot | icon | feature) : ;;
        *) die_usage "--kind must be screenshot, icon or feature" ;;
      esac
      KIND="$2"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --)
      shift
      while [ $# -gt 0 ]; do FILES+=("$1"); shift; done
      ;;
    -*)
      die_usage "unknown option '$1'"
      ;;
    *)
      FILES+=("$1")
      shift
      ;;
  esac
done

[ -n "$PLATFORM" ] || die_usage "--platform is required"
[ "${#FILES[@]}" -gt 0 ] || die_usage "at least one file is required"

REPO_ROOT="${REPO_ROOT:-$(pwd)}"

get_wh() {
  local file="$1"
  if command -v sips >/dev/null 2>&1; then
    local w h
    w="$(sips -g pixelWidth "$file" 2>/dev/null | awk '/pixelWidth:/{print $2}')"
    h="$(sips -g pixelHeight "$file" 2>/dev/null | awk '/pixelHeight:/{print $2}')"
    [ -n "$w" ] && [ -n "$h" ] || return 1
    printf '%s %s\n' "$w" "$h"
    return 0
  fi
  if command -v magick >/dev/null 2>&1; then
    magick identify -format '%w %h' "$file" 2>/dev/null
    return $?
  fi
  if command -v identify >/dev/null 2>&1; then
    identify -format '%w %h' "$file" 2>/dev/null
    return $?
  fi
  return 2
}

nearest_size() {
  local w="$1" h="$2" best="" best_dist=999999999 s sw sh dw dh dist
  for s in $ALL_KNOWN_SIZES; do
    sw="${s%x*}"
    sh="${s#*x}"
    dw=$((sw - w))
    [ "$dw" -lt 0 ] && dw=$((-dw))
    dh=$((sh - h))
    [ "$dh" -lt 0 ] && dh=$((-dh))
    dist=$((dw + dh))
    if [ "$dist" -lt "$best_dist" ]; then
      best_dist="$dist"
      best="$s"
    fi
  done
  printf '%s\n' "$best"
}

copy_to() {
  local src="$1" dest="$2"
  if [ -e "$dest" ] && [ "$FORCE" -ne 1 ]; then
    echo "FATAL: $dest already exists (pass --force to overwrite)" >&2
    return 2
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] would copy $src -> $dest"
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "copied $src -> $dest"
  return 0
}

next_seq() {
  local dir="$1" max=0 n base
  [ -d "$dir" ] || { echo "01"; return 0; }
  for f in "$dir"/*; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    case "$base" in
      [0-9][0-9]_*)
        n="${base%%_*}"
        n="${n#0}"
        [ -n "$n" ] || n=0
        [ "$n" -gt "$max" ] && max="$n"
        ;;
    esac
  done
  printf '%02d\n' "$((max + 1))"
}

EXIT_CODE=0

for src in "${FILES[@]}"; do
  [ -f "$src" ] || { echo "FATAL: not found: $src" >&2; EXIT_CODE=64; continue; }
  wh="$(get_wh "$src")" || { echo "FATAL: could not read dimensions of $src" >&2; EXIT_CODE=1; continue; }
  w="${wh%% *}"
  h="${wh##* }"
  size="${w}x${h}"
  base="$(basename "$src")"

  is_known_ios_size=0
  printf ' %s ' "$IOS_SCREENSHOT_SIZES" | grep -q " $size " && is_known_ios_size=1

  dest=""
  if [ "$PLATFORM" = "ios" ]; then
    if [ "$is_known_ios_size" -eq 1 ] && { [ -z "$KIND" ] || [ "$KIND" = "screenshot" ]; }; then
      dir="$REPO_ROOT/fastlane/screenshots/$LOCALE"
      seq="$(next_seq "$dir")"
      dest="$dir/${seq}_${base}"
    fi
  else
    if { [ "$KIND" = "icon" ] || { [ -z "$KIND" ] && [ "$size" = "512x512" ]; }; } && [ "$size" = "512x512" ]; then
      dest="$REPO_ROOT/fastlane/metadata/android/images/icon.png"
    elif { [ "$KIND" = "feature" ] || { [ -z "$KIND" ] && [ "$size" = "1024x500" ]; }; } && [ "$size" = "1024x500" ]; then
      dest="$REPO_ROOT/fastlane/metadata/android/images/featureGraphic.png"
    elif { [ "$KIND" = "screenshot" ] || [ -z "$KIND" ]; } && [ "$w" -ge 320 ] && [ "$w" -le 3840 ] && [ "$h" -ge 320 ] && [ "$h" -le 3840 ] && [ "$h" -ge "$w" ]; then
      min_side="$w"
      [ "$h" -lt "$min_side" ] && min_side="$h"
      if [ "$min_side" -ge 1200 ]; then
        subdir="tenInchScreenshots"
      elif [ "$min_side" -ge 600 ]; then
        subdir="sevenInchScreenshots"
      else
        subdir="phoneScreenshots"
      fi
      dir="$REPO_ROOT/fastlane/metadata/android/images/$subdir"
      seq="$(next_seq "$dir")"
      dest="$dir/${seq}_${base}"
    fi
  fi

  if [ -z "$dest" ]; then
    nearest="$(nearest_size "$w" "$h")"
    echo "FATAL: $src is ${size} - not a recognised $PLATFORM image size (nearest legal size: $nearest)" >&2
    EXIT_CODE=1
    continue
  fi

  copy_to "$src" "$dest" || EXIT_CODE=$?
done

exit "$EXIT_CODE"
