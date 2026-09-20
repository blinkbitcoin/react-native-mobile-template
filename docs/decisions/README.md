# Architecture decision records

Why this template is shaped the way it is. Each record states the forces, the
decision, what it costs, and the files that embody it — so an ADR can be
checked against the repository rather than believed.

| ADR | Decision | Date |
|---|---|---|
| [0001](0001-expo-cng-no-native-dirs.md) | Expo CNG: no committed `ios/` and `android/`; native changes are plugins or local modules | 2026-09-05 |
| [0002](0002-biome-plus-minimal-eslint.md) | Biome owns formatting and generic lint; ESLint 9 owns only React/Expo semantics, zero overlap | 2026-09-05 |
| [0003](0003-plain-stylesheet-theme.md) | Theming with plain `StyleSheet` and typed tokens, no styling dependency | 2026-09-05 |
| [0004](0004-lingui-i18n.md) | Lingui macros with catalogs compiled to committed TypeScript, no Metro transformer | 2026-09-05 |
| [0005](0005-apollo4-client-preset.md) | Apollo Client 4, `TypedDocumentNode` from the codegen client preset, one mock schema | 2026-09-05 |
| [0006](0006-web-opt-in.md) | Web is a separable target that can be stripped completely at adoption | 2026-09-05 |
| [0007](0007-mise-not-nix.md) | `mise` pins the toolchain for humans and CI, not Nix | 2026-09-05 |
| [0008](0008-release-please-and-store-notes.md) | release-please in manifest mode owns versioning; store notes are generated prose | 2026-09-05 |
| [0009](0009-e2e-launch-by-deep-link.md) | E2E foregrounds the dev client by deep link; the launcher's Bonjour discovery never works | 2026-09-06 |
| [0010](0010-ios-e2e-release-build.md) | iOS E2E runs a Release build and opens the session's first URL itself; Android keeps 0009 | 2026-09-17 |
| [0011](0011-release-chain-by-dispatch.md) | release-please starts beta, web and the release PR's CI by `workflow_dispatch`; no GitHub App | 2026-09-18 |
| [0012](0012-expo-sdk-drift-is-advisory.md) | Expo SDK patch drift is a warning; `minimumReleaseAge` alone decides when a patch comes in | 2026-09-18 |
| [0013](0013-per-commit-queues.md) | CI on `main` and the internal release queue per commit; only store-touching jobs share the `release` queue | 2026-09-19 |
| [0014](0014-green-gate-heals-itself.md) | Beta's green gate dispatches the internal build it is missing instead of waiting for a human | 2026-09-19 |
| [0015](0015-web-on-pages.md) | The web target deploys to a Pages sub-path, with a 404 shell for deep links, tested as the same bytes | 2026-09-19 |
| [0016](0016-job-names-by-purpose.md) | Workflow and job names say what a step is for, in store vocabulary, never a tool's | 2026-09-19 |
| [0017](0017-build-tag-reserved-at-push.md) | The `-build.N` tag is created in Prepare at push time, while the commit is still main's tip;<br>GitHub refuses a later tag once a workflow file changed | 2026-09-19 |
| [0018](0018-store-listing-sync-lane.md) | Additive `sync_metadata`/`pull_metadata` lanes edit the store listing outside a release,<br>gated behind `STORE_METADATA_SYNC_ENABLED`; `release_production` is unchanged | 2026-09-19 |

## Writing a new one

Copy [`template.md`](template.md) to `NNNN-kebab-case-title.md`, keep it under
40 lines, cite the files it applies to, and add a row above. Never rewrite an
accepted record to match a later change: write a new ADR and mark the old one
`Superseded by`. A refinement of the same decision is noted inline with its
date, as in 0002 (ESLint major) and 0004 (compiled catalogs).

Longer guides live next to these: [`../architecture.md`](../architecture.md),
[`../quality.md`](../quality.md), [`../testing.md`](../testing.md),
[`../release-runbook.md`](../release-runbook.md).
