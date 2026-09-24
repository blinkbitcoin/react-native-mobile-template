# Contributing

Start with [`AGENTS.md`](AGENTS.md) — it has the folder map, the full command
table and the rules that CI enforces. This file covers the workflow around a
change.

## Setup

```sh
mise trust && mise install   # toolchain (node, pnpm, ruby, java, ...)
make doctor                  # verify it
make install                 # pnpm dependencies, Ruby gems, git hooks
```

`make install` does all three: `pnpm install --frozen-lockfile`, `bundle
install` into `vendor/bundle` (the fastlane gems `make check-release` needs),
and `lefthook install` through pnpm's `prepare` script, so the hooks below are
active from then on. `NO_BUNDLE=1 make install` skips the Ruby half. See [`docs/local-dev.md`](docs/local-dev.md) for first-run details and
troubleshooting.

## Branching

- Branch off `main`, one logical change per branch. `main` is protected; nothing
  lands except by pull request.
- Name it for the change (`feat/deep-link-details`, `fix/android-abi-split`).
- Use a `git worktree` when you need to work on two branches at once — sharing a
  single checkout between changes wastes prebuilds and loses work.
- Rebase on `main` rather than merging it back in; the branch history is
  discarded by the squash merge anyway.

One branch, one pull request is the default. When a change genuinely needs
several dependent pull requests — a refactor the feature on top of it cannot
be reviewed without — build the stack with `gh stack` (the
[`github/gh-stack`](https://github.com/github/gh-stack) command-line
extension), never by hand-stacking branches and rebasing each one yourself.
The extension owns the base branches, the rebase order and the cross-links in
the pull request bodies; doing that manually is where a force-push loses a
review, and where two branches quietly end up based on the same stale commit.

## Commits and PR titles

Conventional Commits with a closed scope list, enforced by `commitlint` in the
`commit-msg` hook and again on the PR title in CI:

```
<type>(<scope>): <subject>
```

Scopes: `app ui i18n graphql native plugins config tooling ci release deps
deps-dev docs e2e web` (`commitlint.config.mjs` is the source of truth).

Pull requests are **squash-merged**, which means GitHub uses the **PR title** as
the commit message on `main` — and release-please reads those messages to decide
the next version and write the changelog. A sloppy PR title becomes a sloppy
release note. Mark breaking changes with `!` (`feat(app)!: ...`) or a
`BREAKING CHANGE:` footer.

## Before you push

```sh
make check       # every static gate CI runs (no tests, no builds)
make test-unit   # unit + component tests
```

Native-facing changes (`app.config.ts`, `plugins/`, `modules/`) additionally
need `make check-prebuild`. Release-facing changes (`fastlane/`,
`scripts/release/`, workflow pins) need `make check-release`.

Git hooks run a fast subset for you — Biome, ESLint, typos and gitleaks on staged files at
commit time; typecheck, knip and changed-file tests at push time. They are a
safety net, not a substitute for `make check`. Escape hatches exist
(`git commit --no-verify`, `LEFTHOOK=0 git push`) for genuinely broken tooling;
CI still runs the full gate.

For a standing personal tweak rather than a one-off skip, put it in
`lefthook-local.yml` — it is gitignored, it merges over `lefthook.yml`, and it
keeps your workaround out of everyone else's checkout.

## Docs ship with the code

A change to `app.config.ts`, `plugins/`, `modules/`, `src/graphql/`, `scripts/`
or the `Makefile` is expected to come with a `docs/` change; `make check-docs`
warns when it does not. Two things are hard failures:

- adding or removing a `##`-documented make target without updating the command
  table in `AGENTS.md`;
- documenting a make target that does not exist.

New architectural decisions get an entry under `docs/decisions/`.

## Pull requests

Fill in the template checklist honestly — screenshots or a screen recording for
UI changes, and say explicitly when a change is release-affecting so the
[release runbook](docs/release-runbook.md) gets updated in the same PR. Keep PRs
reviewable; split mechanical churn (formatting, codegen output) into its own
commit.

Releases themselves are automated: release-please keeps a release PR open on
`main`, and squash-merging it cuts the version and tags the release. Never edit
a version by hand.
