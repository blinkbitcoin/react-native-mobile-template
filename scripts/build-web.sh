#!/usr/bin/env bash
# The web export, plus the one file GitHub Pages needs that Expo does not write.
#
# Arguments go to `expo export` (the PR workflow passes `--dev`). A script
# rather than `expo export ... && cp ...` in package.json: pnpm appends the
# caller's arguments to the *end* of a script string, which put `--dev` on the
# `cp`.
#
# `output: 'static'` writes one HTML file per route - `details/[id].html` for
# the dynamic one - and Pages serves nothing for `/details/42`. It does serve
# `404.html` for any path it has no file for, so the not-found page doubles as
# the app shell: the router boots from the real URL and renders the route.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm exec expo export --platform web "$@"
cp dist/+not-found.html dist/404.html
