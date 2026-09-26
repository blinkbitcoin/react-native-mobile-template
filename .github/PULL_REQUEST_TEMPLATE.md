<!--
The PR title becomes the commit message on main (squash merge) and feeds
release-please. Conventional Commits, closed scope enum — see CONTRIBUTING.md.
-->

## What and why

<!-- One paragraph. Link the issue: Closes #123 -->

## How to verify

<!-- The commands or steps a reviewer runs. -->

## Checklist

- [ ] PR title is a Conventional Commit with a valid scope (`app ui i18n graphql native plugins config tooling ci release deps deps-dev docs e2e web`)
- [ ] `make check` and `make test-unit` pass locally
- [ ] Every behaviour this PR adds or changes is tested here, error paths and branches included, and the tests are named above; no threshold lowered, no coverage exclusion added
- [ ] Every source file this PR adds or changes has its own sibling test (a route's under `src/__tests__/app/`) that covers it at 100% alone
- [ ] Docs and diagrams updated in this PR: every doc, README table and diagram (mermaid, ASCII, SVG) that shows what changed; searched each changed name with and without `.yml` (`AGENTS.md` command table if a make target changed)
- [ ] User-visible strings go through Lingui and `make gen-i18n` was run
- [ ] Screenshots or a screen recording for UI changes
- [ ] Native change (`app.config.ts`, `plugins/`, `modules/`)? → `make check-prebuild` passes and the plugin/module is documented
- [ ] Release-affecting (`fastlane/`, `scripts/release/`, workflow pins, versioning)? → `make check-release` passes and `docs/release-runbook.md` is updated
- [ ] No secrets, keys or `.env` values added; nothing new reads `process.env` outside `src/config/env`
