#!/usr/bin/env bash
# Prints APP_VERSION and APP_BUILD_NUMBER (KEY=VALUE lines; also to $GITHUB_OUTPUT when set).
# Version: HEAD tag vX.Y.Z → X.Y.Z; else HEAD subject "chore(main): release X.Y.Z" → X.Y.Z;
#          else open release-please PR ("chore(main): release X.Y.Z") → X.Y.Z; else last tag patch+1.
# Build number: first-parent commit count + BUILD_NUMBER_OFFSET (default 1000).
set -euo pipefail
cd "${1:-.}"
offset="${BUILD_NUMBER_OFFSET:-1000}"
count=$(git rev-list --count --first-parent HEAD)
build=$((count + offset))
version=""
tag=$(git tag --points-at HEAD | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)
if [ -n "$tag" ]; then version="${tag#v}"
# The release commit itself, before release-please has tagged it. release-internal
# and release-please are triggered by the same push to main and run concurrently,
# so on the one commit whose build must carry the release version the tag does not
# exist yet, RELEASE_PR_TITLE is empty (this is a push, not a PR) and the
# `autorelease: pending` PR has just been merged. Without this the patch-bump
# fallback stamps 0.1.1 on a 0.2.0 release, and release-beta then looks for a
# v0.2.0-build.N pre-release that was never created. release-please writes this
# exact subject (`chore(main): release X.Y.Z`), so it is a reliable source.
elif subject=$(git log -1 --format=%s 2>/dev/null) &&
  printf '%s' "$subject" | grep -qE '^chore\(main\): release [0-9]+\.[0-9]+\.[0-9]+'; then
  version=$(printf '%s' "$subject" | sed -n 's/^chore(main): release \([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p')
elif [ -n "${RELEASE_PR_TITLE:-}" ]; then version=$(printf '%s' "$RELEASE_PR_TITLE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
elif command -v gh >/dev/null 2>&1 && [ -n "${GH_TOKEN:-}" ]; then
  version=$(gh pr list --state open --label 'autorelease: pending' --json title -q '.[0].title' 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
fi
if [ -z "$version" ]; then
  # Same filter as the HEAD tag above: a prerelease or build-metadata tag
  # (v1.4.2-rc.1, v1.2.3+build, v1.2) would otherwise reach the arithmetic
  # below, fail it, and leave $version empty.
  last=$(git tag -l 'v[0-9]*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)
  last="${last#v}"; last="${last:-0.0.0}"
  IFS=. read -r a b c <<<"$last"; version="$a.$b.$((c + 1))"
fi
# An empty version is worse than a failure: it flows into the release workflow's
# step outputs and produces a build with no version at all.
[ -n "$version" ] || { echo "resolve-version: could not resolve a version" >&2; exit 1; }
printf 'APP_VERSION=%s\nAPP_BUILD_NUMBER=%s\n' "$version" "$build"
if [ -n "${GITHUB_OUTPUT:-}" ]; then printf 'version=%s\nbuild-number=%s\n' "$version" "$build" >> "$GITHUB_OUTPUT"; fi
