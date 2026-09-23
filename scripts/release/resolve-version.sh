#!/usr/bin/env bash
# Prints APP_VERSION and APP_BUILD_NUMBER (KEY=VALUE lines; also to $GITHUB_OUTPUT when set).
# Version: HEAD tag vX.Y.Z → X.Y.Z; else a "chore(<scope>): release X.Y.Z" release
#          commit (HEAD's own subject, or its second parent's when the release PR
#          was merged with a merge commit) → X.Y.Z; else open release-please PR
#          ("chore(<scope>): release X.Y.Z") → X.Y.Z; else last tag patch+1.
# Build number: first-parent commit count + BUILD_NUMBER_OFFSET (default 1000).
#
# shared-workflows ships a contract-identical copy of this script;
# test/resolve-version.bats over there compares the two on stdout and on
# $GITHUB_OUTPUT. Neither copy writes $GITHUB_ENV: resolving a version and
# publishing it into a CI environment are two jobs, and this copy also runs on a
# developer machine under `make version`, where $GITHUB_ENV does not exist.
set -euo pipefail
cd "${1:-.}"
offset="${BUILD_NUMBER_OFFSET:-1000}"
# A non-numeric offset is not an arithmetic error in bash, it is silently 0. That
# drops the build number below the previous build's, and the stores reject that
# permanently with a message naming neither this variable nor this script.
case "$offset" in
  '' | *[!0-9]*)
    echo "resolve-version: BUILD_NUMBER_OFFSET must be a non-negative integer (got '$offset')" >&2
    exit 1
    ;;
esac
count=$(git rev-list --count --first-parent HEAD)
build=$((count + offset))

# release-please scopes its release commit with the release branch's name, so the
# subject on `main` is `chore(main): release 1.2.0` and on `master` it is
# `chore(master): release 1.2.0`. Hardcoding `main` meant releasing from any other
# branch matched nothing here and fell through to the patch bump below, stamping
# a wrong version on a real release with no error. WORKFLOWS_RELEASE_SCOPE overrides the
# branch name for a release-please config whose scope is not the branch.
release_scope="${WORKFLOWS_RELEASE_SCOPE:-${GITHUB_REF_NAME:-main}}"
release_prefix="chore($release_scope): release "

# The subject of the release commit, if HEAD is one. `HEAD` covers a squash or
# rebase merge, which carry the PR title; `HEAD^2` covers a merge commit, whose
# own subject is `Merge pull request #N from …` and whose second parent is the
# release commit itself. Without the second-parent lookup a repository whose
# merge button is set to "Create a merge commit" falls silently back to the
# patch bump -- the original bug, harder to spot because the fix looks present.
# Both are matched anchored, so a commit that merely quotes the subject
# ("Merge pull request #12 from chore(main): release 9.9.9") is not a release.
release_subject() {
  local subject
  for rev in HEAD 'HEAD^2'; do
    subject=$(git log -1 --format=%s "$rev" 2>/dev/null || true)
    case "$subject" in
      "$release_prefix"*) printf '%s' "$subject"; return 0 ;;
    esac
  done
  printf ''
}

version=""
tag=$(git tag --points-at HEAD | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)
subject=$(release_subject)
if [ -n "$tag" ]; then version="${tag#v}"
# The release commit itself, before release-please has tagged it. cd-internal
# and release-please are triggered by the same push to main and run concurrently,
# so on the one commit whose build must carry the release version the tag does not
# exist yet, RELEASE_PR_TITLE is empty (this is a push, not a PR) and the
# `autorelease: pending` PR has just been merged. Without this the patch-bump
# fallback stamps 0.1.1 on a 0.2.0 release, and cd-beta then looks for a
# v0.2.0-build.N pre-release that was never created. release-please writes this
# exact subject (`chore(main): release X.Y.Z`), so it is a reliable source.
elif [ -n "$subject" ]; then
  # Strip the prefix literally rather than matching it as a regex: a scope is a
  # branch name, so it may contain `/`, `.` or `+`, every one of which means
  # something else inside an ERE or a sed address.
  version=$(printf '%s' "${subject#"$release_prefix"}" | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+' || true)
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
