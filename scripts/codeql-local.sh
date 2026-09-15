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

# The queries come out of the config file rather than being restated here: two
# copies of the suite is how a local "clean" stops meaning a CI "clean".
#   `uses: security-and-quality` is the ACTION's shorthand for the pack's
#   javascript-security-and-quality.qls; the CLI wants that path spelled out.
SUITE=$(sed -n 's/^ *- uses: *//p' "$CONFIG" | head -1)
[ -n "$SUITE" ] || { echo "::error::no 'uses:' suite in $CONFIG" >&2; exit 1; }
QUERIES=("codeql/javascript-queries:codeql-suites/javascript-$SUITE.qls")
# Every extra pack - above all AlertSuppression.ql, without which the inline
# markers are silently ignored and this run disagrees with CI about what is
# still open.
while IFS= read -r pack; do
  [ -n "$pack" ] && QUERIES+=("$pack")
done < <(sed -n 's/^ *- \(codeql\/[^ #]*\).*$/\1/p' "$CONFIG")

# ...and so do the exclusions: the same paths-ignore list, as index filters, so
# a local database holds the files a CI one holds. A fresh CI checkout simply
# lacks most of these (prebuild output, the web export, coverage, the gems);
# locally they are usually all sitting right there.
filters=()
while IFS= read -r p; do
  [ -n "$p" ] || continue
  filters+=("exclude:$p" "exclude:$p/**")
done < <(sed -n '/^paths-ignore:/,/^[^ #-]/p' "$CONFIG" | sed -n 's/^ *- *\([^ #]*\).*$/\1/p')
filters+=("exclude:$OUT" "exclude:$OUT/**")
LGTM_INDEX_FILTERS=$(printf '%s\n' "${filters[@]}")
export LGTM_INDEX_FILTERS

echo "== database (javascript-typescript, no build step; ${#filters[@]} index filters from $CONFIG)"
"${CODEQL[@]}" database create "$DB" \
  --language=javascript-typescript \
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
