#!/usr/bin/env bash
# GitHub's CodeQL analysis, on this machine: the same language, the same query
# suite, the same packs and the same path exclusions as
# .github/workflows/codeql.yml - and therefore the same findings, before a push,
# with the inline `// codeql[<rule-id>]` markers shown as suppressed or not.
#
#   make codeql
#
# LOCAL ONLY. CI runs CodeQL on GitHub through the reusable workflow; nothing in
# .github/ calls this file.
#
# JavaScript/TypeScript only, by construction: the suite path and the query pack
# are named after the language. The reusable workflow's `languages` input is
# comma-separated, so a consumer that analyses a second language has to extend
# the mapping below - it is not a switch this script can read off the config.
#
# Output goes to .codeql/ (gitignored): the database, results.sarif and the two
# tool logs. The first run downloads and compiles the query pack, which takes
# minutes; later runs reuse it. Exits 1 while any finding is unsuppressed, so
# this works as a pre-push gate.
set -euo pipefail
cd "$(dirname "$0")/.."

# The CLI, in order of preference. No Nix here (this repo has none, by decision:
# see docs/decisions): a plain binary on PATH first, then the gh extension,
# which is the least-effort route on a machine that already has gh.
if command -v codeql > /dev/null 2>&1; then
  CODEQL=(codeql)
elif command -v gh > /dev/null 2>&1 && gh extension list 2> /dev/null | grep -q 'gh codeql'; then
  CODEQL=(gh codeql)
else
  cat >&2 <<'EOF'
codeql: no CodeQL CLI found. Install one of:

  gh extension install github/gh-codeql   # then: gh codeql --help
  brew install codeql                     # or unpack a release from
                                          # https://github.com/github/codeql-cli-binaries/releases
                                          # and put `codeql` on PATH

This gate is local-only; CI runs CodeQL on GitHub either way.
EOF
  exit 1
fi

CONFIG=.github/codeql/codeql-config.yml
OUT=.codeql
DB="$OUT/db"
SARIF="$OUT/results.sarif"
[ -f "$CONFIG" ] || { echo "::error::no CodeQL config at $CONFIG" >&2; exit 1; }
mkdir -p "$OUT"
echo "== codeql $("${CODEQL[@]}" version --format=terse), config $CONFIG"

die() { echo "::error::$*" >&2; exit 1; }

# Prints the items of the top-level YAML list named $1, one per line, with
# trailing comments and whitespace stripped. Range-scoped to that block on
# purpose: an unscoped grep for `- codeql/...` would also match such a line
# sitting in a comment, in another key's list, or in prose.
yaml_list() {
  sed -n "/^$1:/,/^[^ #-]/p" "$CONFIG" |
    sed -n 's/^[[:space:]]*-[[:space:]]*//p' |
    sed 's/[[:space:]]*#.*$//; s/[[:space:]]*$//' |
    grep -v '^$' || true
}

# This script is JavaScript/TypeScript ONLY, by construction: both the suite
# path and the suppression pack below are named after the language, so a config
# analysing anything else needs this mapping extended rather than reused. The
# workflow's `languages` input is comma-separated and this is not; a consumer
# that changes it has to change this too, and would rather find out here.
LANGUAGE=javascript-typescript
# The query pack is named after the language family, not the extractor.
QL_PACK=codeql/javascript-queries

# The queries come out of the config file rather than being restated here: two
# copies of the suite is how a local "clean" stops meaning a CI "clean". Which
# is also why nothing below is allowed to skip an entry it does not recognise -
# dropping one silently is that same divergence, just harder to notice.
#   `uses: security-and-quality` is the ACTION's shorthand for the pack's
#   javascript-security-and-quality.qls; the CLI wants that path spelled out.
queries_entries=()
while IFS= read -r entry; do queries_entries+=("$entry"); done < <(yaml_list queries)
[ "${#queries_entries[@]}" -eq 1 ] ||
  die "$CONFIG names ${#queries_entries[@]} entries under 'queries:'; this script maps exactly one suite. Extend it rather than letting the local run analyse less than CI does."
case "${queries_entries[0]}" in
  uses:*)
    SUITE="${queries_entries[0]#uses:}"
    SUITE="${SUITE#"${SUITE%%[![:space:]]*}"}" # ltrim
    ;;
  *) die "unsupported 'queries:' entry '${queries_entries[0]}' in $CONFIG - expected 'uses: <suite>'" ;;
esac
# A bare suite name is the only form this mapping knows. A path or a local .ql
# file would be handed to the CLI verbatim by the action and mangled here.
case "$SUITE" in
  '' | */* | *.ql | *.qls)
    die "unsupported 'uses:' form '$SUITE' in $CONFIG - this script maps a bare suite name (e.g. security-and-quality); extend codeql-local.sh"
    ;;
esac
QUERIES=("$QL_PACK:codeql-suites/javascript-$SUITE.qls")

# Every pack in the `packs:` block - above all AlertSuppression.ql, without
# which the inline markers are ignored and this run disagrees with CI about what
# is still open. Third-party packs are passed through; anything that is not a
# `<scope>/<name>[:<path>]` spec stops the run instead of being dropped.
have_suppression=0
while IFS= read -r pack; do
  case "$pack" in
    */*) QUERIES+=("$pack") ;;
    *) die "unsupported 'packs:' entry '$pack' in $CONFIG - expected <scope>/<name>[:<path>]" ;;
  esac
  case "$pack" in
    *AlertSuppression.ql) have_suppression=1 ;;
  esac
done < <(yaml_list packs)
[ "$have_suppression" -eq 1 ] ||
  echo "::warning::$CONFIG loads no AlertSuppression.ql pack, so inline // codeql[rule-id] markers count for nothing - here or in CI"

# ...and so do the exclusions: the same paths-ignore list, as index filters, so
# a local database holds the files a CI one holds. A fresh CI checkout simply
# lacks most of these (prebuild output, the web export, coverage, the gems);
# locally they are usually all sitting right there.
filters=()
while IFS= read -r p; do
  [ -n "$p" ] || continue
  filters+=("exclude:$p")
  # A directory also needs the subtree; a file-shaped pattern does not, and
  # `exclude:.../messages.ts/**` can never match anything. The leading-dot test
  # keeps `.workflows` and `.codeql` on the directory side.
  case "${p##*/}" in
    ?*.?*) ;;
    *) filters+=("exclude:$p/**") ;;
  esac
done < <(yaml_list paths-ignore)
filters+=("exclude:$OUT" "exclude:$OUT/**")
LGTM_INDEX_FILTERS=$(printf '%s\n' "${filters[@]}")
export LGTM_INDEX_FILTERS

echo "== database ($LANGUAGE, no build step; ${#filters[@]} index filters from $CONFIG)"
"${CODEQL[@]}" database create "$DB" \
  --language="$LANGUAGE" \
  --source-root . \
  --overwrite > "$OUT/create.log" 2>&1 ||
  { tail -30 "$OUT/create.log" >&2; echo "::error::database create failed (full log: $OUT/create.log)" >&2; exit 1; }

echo "== analyze: ${QUERIES[*]} (the pack is downloaded once)"
"${CODEQL[@]}" database analyze "$DB" "${QUERIES[@]}" \
  --download \
  --format=sarif-latest \
  --output="$SARIF" > "$OUT/analyze.log" 2>&1 ||
  { tail -30 "$OUT/analyze.log" >&2; echo "::error::analyze failed (full log: $OUT/analyze.log)" >&2; exit 1; }

echo "== findings ($SARIF)"
node scripts/codeql-findings.mjs "$SARIF"
