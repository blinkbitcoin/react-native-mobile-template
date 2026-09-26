# 0023. Shared workflows pinned by SHA, and CD exercised on every PR

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Every CI and CD job runs a reusable workflow from `blinkbitcoin/shared-workflows`.
The callers used the moving `@v0` tag, which shared-workflows re-points the
moment one of its releases merges. A shared change therefore reached this
repository's CD with no PR here and no CI run against it. And no CI anywhere ran
the release half: shared-workflows tests its scripts with a stub `gh` and a
two-line fake generator, and the template's tests stopped at its own code. The
first run of the store-notes chain against this repository was the release PR
on main.

## Decision

Every call is pinned to one commit SHA with its version beside it, and a PR
runs the CD logic against the pinned shared code:

- `.github/workflows/*.yml` — every shared `uses:` is `@<sha> # vX.Y.Z`, all the same.
- `.github/dependabot.yml` — the `shared-workflows` group moves every pin in one PR, without the cooldown.
- `.github/zizmor.yml` — `hash-pin` for shared-workflows, `ref-pin` for the rest.
- `scripts/workflow-contract.test.mjs` — every call against the inputs and secrets its workflow declares at the pin.
- `scripts/release/cd-notes.test.mjs` — cd-release's build-env, the shared `build-env.sh`, `pr-notes.sh` and `notes.sh`,
  and our `notes.mjs`, end to end, then read back the way the release lanes read it.

## Consequences

A shared release changes nothing here until its Dependabot PR is green and
merged, and that PR's Unit job has run the new shared code against this
repository. The price is one PR per shared release. A fix no longer arrives by
itself: someone has to merge it. The PR CI still stands in for `gh`, the model
and release-please's body split; a dry-run of the whole workflow on GitHub is
the next step (the shared `pr-release-notes.yml` `dry-run` input).

## Alternatives

- **Keep `@v0` and trust shared-workflows' own CI** — it never checks out a consumer, so it cannot see a consumer's contract.
- **Pin to a version tag (`@v0.13.0`)** — readable, but a tag can be moved; a SHA cannot, and Dependabot keeps the comment.
