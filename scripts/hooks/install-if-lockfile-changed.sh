#!/usr/bin/env bash
# Reinstall dependencies when a merge or a branch checkout changed the lockfile.
#
# Called from lefthook's post-merge / post-checkout hooks with the hook name
# first and git's own hook arguments after it. Both revision pairs have to be
# computed here: git hands post-checkout the two refs but post-merge only a
# squash flag, and lefthook's `{1}` templating expands inside the YAML string --
# `HEAD@{1}` became `HEAD@0`, so every merge printed
# `fatal: ambiguous argument 'HEAD@0'` and no install ever ran.
set -euo pipefail
cd "$(dirname "$0")/../.."

LOCKFILE=pnpm-lock.yaml
# Overridable so the unit test can watch the decision without installing.
INSTALL_CMD=${RNW_INSTALL_CMD:-"pnpm install --frozen-lockfile"}

hook=${1:-}
shift || true

case "$hook" in
  post-merge)
    # The merge commit is already HEAD; ORIG_HEAD is where the branch was.
    old=ORIG_HEAD
    new=HEAD
    ;;
  post-checkout)
    # $1 old ref, $2 new ref, $3 branch flag (0 = file checkout, which leaves
    # HEAD alone and cannot mean "the branch brought a different lockfile").
    [ "${3:-1}" = 1 ] || exit 0
    old=${1:-}
    new=${2:-}
    ;;
  *)
    echo "usage: $0 post-merge <squash-flag> | post-checkout <old> <new> <flag>" >&2
    exit 2
    ;;
esac

# A null ref (the first checkout of a fresh clone) or a missing ORIG_HEAD (a
# fast-forward pull with nothing to merge) has nothing to compare against.
for rev in "$old" "$new"; do
  git rev-parse --verify --quiet "$rev^{commit}" >/dev/null || exit 0
done

if git diff --name-only "$old" "$new" -- "$LOCKFILE" | grep -q .; then
  echo "$LOCKFILE changed: $INSTALL_CMD"
  $INSTALL_CMD
fi
