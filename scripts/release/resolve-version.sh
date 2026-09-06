#!/usr/bin/env bash
# Prints APP_VERSION and APP_BUILD_NUMBER (KEY=VALUE lines; also to $GITHUB_OUTPUT when set).
# Version: HEAD tag vX.Y.Z → X.Y.Z; else open release-please PR ("chore(main): release X.Y.Z") → X.Y.Z; else last tag patch+1.
# Build number: first-parent commit count + BUILD_NUMBER_OFFSET (default 1000).
set -euo pipefail
cd "${1:-.}"
offset="${BUILD_NUMBER_OFFSET:-1000}"
count=$(git rev-list --count --first-parent HEAD)
build=$((count + offset))
version=""
tag=$(git tag --points-at HEAD | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)
if [ -n "$tag" ]; then version="${tag#v}"
elif [ -n "${RELEASE_PR_TITLE:-}" ]; then version=$(printf '%s' "$RELEASE_PR_TITLE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
elif command -v gh >/dev/null 2>&1 && [ -n "${GH_TOKEN:-}" ]; then
  version=$(gh pr list --state open --label 'autorelease: pending' --json title -q '.[0].title' 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
fi
if [ -z "$version" ]; then
  last=$(git tag -l 'v[0-9]*' --sort=-v:refname | head -1); last="${last#v}"; last="${last:-0.0.0}"
  IFS=. read -r a b c <<<"$last"; version="$a.$b.$((c + 1))"
fi
printf 'APP_VERSION=%s\nAPP_BUILD_NUMBER=%s\n' "$version" "$build"
if [ -n "${GITHUB_OUTPUT:-}" ]; then printf 'version=%s\nbuild-number=%s\n' "$version" "$build" >> "$GITHUB_OUTPUT"; fi
