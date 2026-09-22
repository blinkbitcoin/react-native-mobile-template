# 21. Store notes are drafted into the release PR, once, for review

- **Status:** Accepted
- **Date:** 2026-09-22

## Context

[0008](0008-release-please-and-store-notes.md) generated the store notes at
build time on every tier. The beta is dispatched the instant a release exists,
so nobody read the generated prose before it reached TestFlight external and
Play open beta, and the LLM ran on every push to `main` for notes only
internal testers see. The prompt was split between a fastlane file and code.

## Decision

Generate the store notes once, into the release PR body, and treat that text
as final downstream.

- `.github/workflows/release-please.yml` — the `Store Notes` job calls the
  shared `release-pr-notes.yml` with the PR's number and branch; it is the only
  job that may call an LLM.
- `release-notes.prompt.md` — the whole system prompt, versioned at the root.
- `scripts/release/notes.mjs` — a verbatim `## Store notes` section ends at a
  marker or a rule, and is never regenerated or extended.
- the three CD callers — no LLM variables or keys; beta and production copy.

## Consequences

The prose is reviewed with the version bump, the one human step that already
existed, and every tier ships the same text. release-please carries the text
between its two `---` lines into the release body, and skips a PR update only
on a body it wrote itself, so every push to `main` now rewrites the release PR
and re-dispatches CI on it; a hand edit in the PR lasts until that push. One
locale for now. `CHANGELOG.md` stays technical: release-please regenerates it.

## Alternatives

- **Keep build-time generation, add a manual gate before beta** — a second
  human step per release, against 0008's "merging is the only human step".
- **Prose in `CHANGELOG.md`** — overwritten by release-please, or a post-tag
  commit that cuts another internal build.
