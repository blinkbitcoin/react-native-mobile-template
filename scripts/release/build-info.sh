#!/usr/bin/env bash
# Writes build-info.json: the provenance record for one build.
#
#   { sha, version, buildNumber, stage, fingerprint: { ios, android },
#     expoSdk, reactNative, workflowRunId, artifacts: {} }
#
# Version/build default to scripts/release/resolve-version.sh when APP_VERSION /
# APP_BUILD_NUMBER are not already in the environment, so this is safe to run
# locally as well as from CI. `artifacts` starts empty; the release workflow
# fills it in as each artifact lands.
#
# Env: APP_VERSION, APP_BUILD_NUMBER, BUILD_STAGE (default "development"),
#      GITHUB_SHA, GITHUB_RUN_ID, BUILD_INFO_PATH (default ./build-info.json).
set -euo pipefail
cd "$(dirname "$0")/../.."

out="${BUILD_INFO_PATH:-build-info.json}"
stage="${BUILD_STAGE:-development}"
sha="${GITHUB_SHA:-$(git rev-parse HEAD)}"
run_id="${GITHUB_RUN_ID:-}"

if [ -z "${APP_VERSION:-}" ] || [ -z "${APP_BUILD_NUMBER:-}" ]; then
  # GITHUB_OUTPUT is cleared so resolving here never writes step outputs the
  # caller did not ask for.
  resolved="$(GITHUB_OUTPUT='' bash scripts/release/resolve-version.sh)"
  APP_VERSION="${APP_VERSION:-$(printf '%s\n' "$resolved" | sed -n 's/^APP_VERSION=//p')}"
  APP_BUILD_NUMBER="${APP_BUILD_NUMBER:-$(printf '%s\n' "$resolved" | sed -n 's/^APP_BUILD_NUMBER=//p')}"
fi

# The CLI prints the full source list; we only want the hash. Prefer the
# installed binary over `npx` so CI never reaches the network here.
fingerprint_bin="./node_modules/.bin/fingerprint"
fingerprint_for() {
  if [ -x "$fingerprint_bin" ]; then
    "$fingerprint_bin" fingerprint:generate --platform "$1"
  else
    npx --yes @expo/fingerprint fingerprint:generate --platform "$1"
  fi | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).hash))'
}

ios_fingerprint="$(fingerprint_for ios)"
android_fingerprint="$(fingerprint_for android)"

# The JSON is assembled in node so quoting and escaping are its problem, not
# the shell's; values are passed through the environment for the same reason.
# shellcheck disable=SC2016 # single quotes are deliberate: `process.env` is JS and must reach node unexpanded.
env \
  "BUILD_INFO_VERSION=$APP_VERSION" \
  "BUILD_INFO_BUILD_NUMBER=$APP_BUILD_NUMBER" \
  "BUILD_INFO_SHA=$sha" \
  "BUILD_INFO_STAGE=$stage" \
  "BUILD_INFO_RUN_ID=$run_id" \
  "BUILD_INFO_IOS=$ios_fingerprint" \
  "BUILD_INFO_ANDROID=$android_fingerprint" \
  "BUILD_INFO_OUT=$out" \
  node -e '
const fs = require("node:fs");
const pkg = require("./package.json");
const dep = (n) => (pkg.dependencies?.[n] ?? "").replace(/^[~^]/, "");
fs.writeFileSync(process.env.BUILD_INFO_OUT, `${JSON.stringify({
  sha: process.env.BUILD_INFO_SHA,
  version: process.env.BUILD_INFO_VERSION,
  buildNumber: Number(process.env.BUILD_INFO_BUILD_NUMBER),
  stage: process.env.BUILD_INFO_STAGE,
  fingerprint: { ios: process.env.BUILD_INFO_IOS, android: process.env.BUILD_INFO_ANDROID },
  expoSdk: dep("expo"),
  reactNative: dep("react-native"),
  workflowRunId: process.env.BUILD_INFO_RUN_ID || null,
  artifacts: {},
}, null, 2)}\n`);
'

echo "wrote $out"
