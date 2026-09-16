# Quality gates

`make check` is every static gate CI runs, with no tests and no builds. Run it
before pushing. Each gate below is also a target of its own, so you can run
just the one that failed.

## Who owns what

| Tool | Owns | Config |
| --- | --- | --- |
| Biome | Formatting, import sorting, generic lint, the react and test rule domains, `noConsole`, restricted imports | `biome.json` |
| ESLint | React and Expo semantic rules only: `react-hooks` including the React Compiler rules, and the Expo env-var rules | `eslint.config.mjs` |
| TypeScript | Types | `tsconfig.json` |
| knip | Unused files, exports and dependencies | `knip.json` |
| typos | Spelling, across the repo including Markdown | `typos.toml` |
| commitlint | Commit and PR-title conventions | `commitlint.config.mjs` |
| pnpm | Dependency provenance, release age, allowed builds, audit exceptions | `pnpm-workspace.yaml` |

Nothing is enabled in two linters at once. `eslint.config.mjs` turns off every
preset rule that duplicates a Biome rule, and `biome.json` turns off the two
Biome rules that would duplicate ESLint's hooks rules.

### Biome and ESLint overlap

Turned off in ESLint because Biome already covers them:

| ESLint rule | Biome rule |
| --- | --- |
| `import/order`, `import/first`, `import/no-duplicates`, `prettier/prettier` | Biome's formatter and `organizeImports` assist |
| `eqeqeq` | `suspicious/noDoubleEquals` |
| `no-dupe-args` | `suspicious/noDuplicateParameters` |
| `no-dupe-class-members`, `@typescript-eslint/no-dupe-class-members` | `suspicious/noDuplicateClassMembers` |
| `no-dupe-keys` | `suspicious/noDuplicateObjectKeys` |
| `no-duplicate-case` | `suspicious/noDuplicateCase` |
| `no-empty-pattern` | `correctness/noEmptyPattern` |
| `no-redeclare`, `@typescript-eslint/no-redeclare` | `suspicious/noRedeclare` |
| `no-unreachable` | `correctness/noUnreachable` |
| `no-unsafe-negation` | `suspicious/noUnsafeNegation` |
| `no-unused-labels` | `correctness/noUnusedLabels` |
| `no-unused-vars`, `@typescript-eslint/no-unused-vars` | `correctness/noUnusedVariables` |
| `no-with` | `suspicious/noWith` |
| `use-isnan` | `correctness/useIsNan` |
| `valid-typeof` | `correctness/useValidTypeof` |
| `@typescript-eslint/no-useless-constructor` | `complexity/noUselessConstructor` |
| `@typescript-eslint/no-extra-non-null-assertion` | `suspicious/noExtraNonNullAssertion` |
| `@typescript-eslint/no-empty-object-type`, `@typescript-eslint/no-wrapper-object-types` | `complexity/noBannedTypes` |
| `react/jsx-key` | `correctness/useJsxKeyInIterable` |
| `react/jsx-no-comment-textnodes` | `suspicious/noCommentText` |
| `react/jsx-no-duplicate-props` | `suspicious/noDuplicateJsxProps` |
| `react/no-children-prop` | `correctness/noChildrenProp` |
| `react/no-danger-with-children` | `security/noDangerouslySetInnerHtmlWithChildren` |
| `react/no-render-return-value` | `correctness/noRenderReturnValue` |

Two deliberate non-overlaps:

- `react-hooks/*` stays with ESLint, so Biome turns
  `correctness/useExhaustiveDependencies` and `correctness/useHookAtTopLevel`
  off. ESLint has the React Compiler rules and Biome has no equivalent.
- `react/no-unknown-property` stays on. Biome's `correctness/noUnknownProperty`
  validates CSS property names in stylesheets and cannot fire on JSX, so there
  is no real overlap.

Add a rule to one side only, and record which side in the config comment.

## Every gate in `make check`

`make check` = `check-code` + `check-gen` + `check-deps` + `check-ci` +
`check-docs` + `check-release`.

| Target | Runs | Owns |
| --- | --- | --- |
| `make typecheck` | `tsc --noEmit` | Types. `strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,<br>`verbatimModuleSyntax`, `noImplicitOverride`, `noFallthroughCasesInSwitch` |
| `make lint` | `biome lint .` then `eslint . --max-warnings=0` | Lint, both halves. Warnings are failures |
| `make format-check` | `biome format .` | Formatting. `make format` writes |
| `make knip` | `knip` | Unused files, exports, dependencies |
| `make spell` | `typos` | Spelling, Markdown included |
| `make check-code` | the five above | The fast local gate |
| `make check-gen` | `pnpm i18n:check`, `pnpm codegen:check` | Drift in generated catalogs and generated GraphQL documents |
| `make check-deps` | `pnpm deps:check`, `pnpm deps:audit`, `pnpm deps:licenses` | Expo SDK drift (`expo install --check` and `expo-doctor`), high-severity vulnerabilities in production dependencies,<br>lockfile provenance (`scripts/check-lockfile.sh`), and the license allowlist (`scripts/check-licenses.mjs`) |
| `make check-ci` | `scripts/shellcheck.sh`, `actionlint` | The CI itself: every `scripts/**/*.sh`, and the workflow files |
| `make check-docs` | `scripts/check-docs.sh`, `scripts/check-docs-tables.mjs`, `scripts/check-diagrams.mjs` | Warns when architecture-relevant paths changed with no `docs/` change.<br>Fails when `AGENTS.md`'s command table and the Makefile's `##`-documented targets disagree in either direction,<br>when a markdown table cell has a line wider than 120 visible characters,<br>or when a fenced `mermaid` block does not parse |
| `make check-release` | `ruby -c` over the Fastfile and lanes, `fastlane lanes`, and the minitest suite in `fastlane/test/lanes_test.rb` | That the lanes parse and that their pure logic still behaves.<br>Needs the Ruby gems `make install` installs, and talks to no store |

Not in `make check`, because each is slow or needs a build:

| Target | Runs |
| --- | --- |
| `make check-prebuild` | Two prebuilds into temp directories, asserting the config plugin output |
| `make bundle-secrets-check` | Exports the bundle and asserts no non-public key leaked into it |
| `make codeql` | CodeQL's `security-and-quality` suite over the whole tree — see below |
| `make test`, `make unit`, `make coverage` | See [testing.md](testing.md) |

`make lint` and `make check-code` are what the pre-push hook and the CI
`checks` job cover between them. The CI mapping table is in [ci.md](ci.md).

## What `make check-docs` checks

CI runs the same thing through the `check:docs` package script, which the
workflows repo's `checks.yml` calls when its `docs-check` input is on. Before
that input existed this gate ran on no CI job at all — it was a local-only
courtesy, which is how a stale command table could reach `main`.

| Check | Fails on | Escape hatch |
| --- | --- | --- |
| Freshness | nothing — it warns | Touch `docs/`, or ignore the warning deliberately |
| Command table | `AGENTS.md` and the Makefile's `##`-documented targets disagreeing in either direction | None. Fix whichever side is wrong |
| Table width | a markdown table cell line wider than 120 visible characters | Break the cell with `<br>`; the limit is `MAX_LINE` in `scripts/check-docs-tables.mjs` |
| Mermaid | a fenced `mermaid` block the parser rejects | Fix the diagram. There is no ignore |

The freshness warning reads a `package.json` change as architectural only when
a non-dependency key moved — `scripts`, `engines`, `packageManager`,
`expo.install.exclude`, the package identity — so a version or dependency bump
never asks for a docs update (`scripts/manifest-structural.mjs`), and a
Dependabot PR (`PR_AUTHOR`) is exempt outright.

Table width is 120, not the 72 the sibling repos use: theirs is tuned for the
narrow README column npm renders, while these tables are read on GitHub at full
page width. Measured on this repo, 72 flags 117 lines and 120 flags 25 — the
ones that actually squeeze a neighbouring column until its code spans wrap.

**The mermaid check is the one gate that needs the network**, on a cold `npx`
cache: it runs a pinned `@mermaid-js/mermaid-cli` rather than vendoring a
parser. When the CLI cannot be fetched or its browser cannot launch, the check
skips with a warning instead of blocking an offline developer — as a
`::warning::` annotation when `CI` is set, so a skipped run is visible in the
log rather than silently green. Locally it only looks at docs that changed
against `origin/main`; CI passes `--all`.

## Suppressing something, correctly

Each gate has one supported escape hatch. Use it, with a comment saying why.

| Gate | Mechanism | Where |
| --- | --- | --- |
| Biome lint | `// biome-ignore lint/<group>/<rule>: <reason>` on the line above. A reason is required | The code |
| Biome, whole path | An entry in `files.includes` with a `!` prefix, or an `overrides` entry that relaxes rules for a path | `biome.json` |
| ESLint | `// eslint-disable-next-line <rule> -- <reason>` | The code |
| knip | An `ignore`, `ignoreDependencies`, `ignoreBinaries` or `ignoreUnresolved` entry, or the `knipignore` JSDoc tag on an export | `knip.json` |
| typos | An entry under `[default.extend-words]`, or a path in `extend-exclude` | `typos.toml` |
| Vulnerability audit | `auditConfig.ignoreGhsas`, one comment **per id** — the advisory, the dependency path that pulls it in, why it is unreachable from app code, and what should make us look again | `pnpm-workspace.yaml` |
| Expo SDK version check | `expo.install.exclude` | `package.json` |
| `minimumReleaseAge` | `minimumReleaseAgeExclude`, pinned as `name@exact-version` so the guard still applies to later releases | `pnpm-workspace.yaml` |
| Package build scripts | `onlyBuiltDependencies` or `allowBuilds`. `strictDepBuilds` forces an explicit decision | `pnpm-workspace.yaml` |
| Coverage | Change the threshold in `jest.config.ts`, deliberately, not silently | `jest.config.ts` |
| CodeQL | `// codeql[<rule-id>]` alone on the line directly above the code,<br>with the reason in a comment *above the marker* — never between it and the code.<br>**Never** dismiss the alert in the GitHub UI or API | The code |

Rules of thumb: suppress the narrowest scope that works, put the reason in the
suppression itself, and never widen an ignore pattern to hide one file.

**An audit ignore without a per-entry reason is not mergeable.** One comment
covering a block of ids is the failure mode this rule exists for: the ids
outlive the reason, the list only ever grows, and nobody can tell which entry
is still true. Each id gets its own four answers — which advisory, which
dependency path pulls it in, why app code cannot reach the vulnerable call, and
what would make it worth re-checking. An advisory you cannot answer all four
for is one to fix, not to ignore.

The fourth answer is the one that rots, so make it checkable: a date, a version
or a named upstream change, not "when a fix exists". Read both sources before
writing it — GitHub's advisory record and the npm registry data `pnpm audit`
actually prints disagree in practice, and a fix can be published while the
GitHub record still says `first_patched_version: null`. When the fix is real
but not yet installable, say what is holding it (a `minimumReleaseAge` window,
a transitive pin) and from when it stops holding. In CI the audit is advisory
on a pull request and
blocking on `main` (`audit-soft-on-pr` in
[the workflows' consumer guide](https://github.com/blinkbitcoin/react-native-workflows/blob/main/docs/consumer-guide.md)),
so an ignore added to get a PR green is an ignore that was never needed.

## CodeQL, and why suppression is a source comment

CodeQL runs two ways from one config file, `.github/codeql/codeql-config.yml`:
`.github/workflows/codeql.yml` hands that path to
`github/codeql-action/init`, and `make codeql` parses the suite, the packs and
the `paths-ignore` list out of the same file. One file, so a local "clean" and a
CI "clean" mean the same thing.

It is **advanced setup**, not GitHub's Default setup, precisely so those choices
are files in this repository that a reviewer sees in a diff rather than toggles
on a settings page. It is **informational**: leave `codeql` out of the required
checks, because a pack download that times out must not be able to block a
merge. Alerts land under Security → Code scanning.

`make codeql` needs a CodeQL CLI, which nothing else here does and `make check`
therefore does not run it. Either route works:

```
gh extension install github/gh-codeql    # if you already have gh
brew install codeql                      # or a release from github/codeql-cli-binaries
```

The first run downloads and compiles the query pack (minutes); later runs reuse
it. Output lands in the gitignored `.codeql/`, and the command exits non-zero
while any finding is unsuppressed, so it works as a pre-push gate.

**Suppress a false positive with an inline marker, not a dismissal.** A marker
alone on its line covers that line and **the line immediately below it**, so the
marker has to be the last thing before the code. The reason goes *above* the
marker:

```ts
// The id is generated by scripts/x.mjs and never reaches this from a request.
// codeql[js/some-rule-id]
const value = untrusted;
```

Putting the reason between the marker and the code is the mistake to avoid: the
marker would then cover the comment, the finding would stay open, and nothing
would say so.

This works only because the config loads `codeql/javascript-queries:AlertSuppression.ql`.
Without that pack the marker is silently ignored — the comment sits there
looking correct while the alert keeps reappearing, which is how esign lost three
rounds to one JWT false positive.

The alternative, dismissing the alert through the UI or the API, is worse for
two concrete reasons: the dismissal is keyed to the alert's *fingerprint*, so it
evaporates the next time the file moves or the surrounding lines shift and the
alert re-opens with nobody having changed anything; and it is invisible in
review. A marker travels with the code, is reviewed in the diff that introduces
it, and silences exactly one site rather than the whole query — the same rule
firing elsewhere still reports.

## knip runs in default mode

`make knip` runs `knip`, not `knip --strict`. Production mode resolves only the
production graph, which means it flags exports used solely by tests as unused
unless every test file is marked with `!` patterns. That trade is not worth it
here. Default mode still catches unused files, unused exports and unused
dependencies, which is the point.

There is deliberately **no** `knip` script in `package.json`. `expo-doctor`'s
"Check package.json for common issues" fails when a script name collides with
a binary in `node_modules/.bin`, and `make check-deps` runs `expo-doctor`. The
Makefile and the pre-push hook both run `pnpm knip`, which resolves the binary
from `node_modules/.bin` precisely because no script of that name exists. That
is the supported path. Leave it alone.

## Commit conventions

Conventional Commits with a closed scope list, enforced by commitlint in the
`commit-msg` hook and on PR titles in CI. Squash merges take the PR title as
the commit message, which is why both are linted.

```
<type>(<scope>): <lowercase subject>
```

Allowed scopes (`commitlint.config.mjs`):

| | | | |
| --- | --- | --- | --- |
| `app` | `ui` | `i18n` | `graphql` |
| `native` | `plugins` | `config` | `tooling` |
| `ci` | `release` | `deps` | `deps-dev` |
| `docs` | `e2e` | `web` | |

`body-max-line-length` and `footer-max-line-length` are off, so a long trailer
or a pasted log in the body will not fail the hook.

## Git hooks and escape hatches

Hooks are installed by `make install` and listed in `lefthook.yml`. The hook
table and the `--no-verify` / `LEFTHOOK=0` escape hatches are in
[local-dev.md](local-dev.md).

## `publicHoistPattern` and babel-preset-expo

`pnpm-workspace.yaml` hoists `babel-preset-expo` (alongside pnpm's two
defaults, `*eslint*` and `*prettier*`). This is load-bearing.

`babel.config.js` names `babel-preset-expo`, and Babel resolves a preset from
the config file's own directory. pnpm's strict `node_modules` does not expose
it there, because the preset is a transitive dependency of `expo`. Metro's
transform workers get away with that. The in-process tree-shaking serializer
used by `expo export:embed --minify false` does not, and that is exactly the
path `gradle bundleRelease` takes. Without the hoist, every Android release
build fails at `:app:createBundleReleaseJsAndAssets` with "Failed to construct
transformer: Cannot find module 'babel-preset-expo'".

Setting `publicHoistPattern` replaces pnpm's defaults, which is why the two
default patterns are repeated in the file. Do not drop them.
