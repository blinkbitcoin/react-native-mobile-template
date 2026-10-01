# 0026. CD pipelines from the shared workflows

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

0011, 0013, 0016 and 0017 settled how the release path is wired, and every
decision lived in this repository's `cd-*.yml` files: about 1,500 lines of
`needs:` chains, store-toggle gating, the Huawei chain, the security gate and
four inline shell jobs. An app adopting shared-workflows had to copy all of it,
and a change to the design was a change to every app.

## Decision

The job graph is shared-workflows'. Four pipeline workflows chain the existing
leaves: `publish-internal.yml`, `publish-beta.yml`, `publish-production.yml`
and `publish-store-listing.yml`. The hotfix is one call to `publish-ota.yml`.

- **A CD file is one `uses:`.** It keeps what only a workflow's own file can
  hold: the trigger, the concurrency group, the permissions, the secrets, and
  the inputs it passes.
- **Settings are inputs, read from repository variables here.** The pipelines
  never read `vars`, so the contract check sees every toggle. An unset variable
  is the empty string, so a number is `fromJSON(vars.X || '1000')` and a
  boolean is `vars.X == 'true'`.
- **Four inline jobs are gone.** They were inputs of the leaves all along:
  Huawei takes its bundle through `release-tag` and `release-assets`, the
  beta store notes are `append` from `build-info`, the production stage note is
  `release-notes-text`, and the hotfix baseline is `baseline-tag: latest`.
- **The graph tests moved with the graph.** `test/pipelines.test.mjs` upstream
  evaluates each pipeline the way GitHub decides it. `scripts/release-workflows.test.mjs`
  here holds what a caller still decides: the groups, the permissions, the
  inputs, the dispatch chain around them, the beta gate and the push filter.
- **`make init --no-web`** removes the `web` input and the two Pages scopes
  that go with it, marked together in `cd-production.yml`, instead of deleting
  a job.

This supersedes where 0011, 0013, 0016 and 0017 name jobs and files; their
decisions (dispatch the chain, queue per commit, name jobs by purpose, reserve
the build tag at push time) stand, now implemented by the pipelines.

## Consequences

- Job names in the Actions UI read `Internal / Build iOS`: the caller's job,
  then the pipeline's. A branch rule that requires a check by name must use
  that form.
- The caller files must keep their names and display names: `require-green-workflow`
  and the beta retry's `workflow_run` listener name them.
- A change to the release design is a shared-workflows release and a pin bump,
  and 0023's dry run exercises it against this repository before any CD run
  uses it.
