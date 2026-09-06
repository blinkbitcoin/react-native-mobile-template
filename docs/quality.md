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
| `make typecheck` | `tsc --noEmit` | Types. `strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noImplicitOverride`, `noFallthroughCasesInSwitch` |
| `make lint` | `biome lint .` then `eslint . --max-warnings=0` | Lint, both halves. Warnings are failures |
| `make format-check` | `biome format .` | Formatting. `make format` writes |
| `make knip` | `knip` | Unused files, exports, dependencies |
| `make spell` | `typos` | Spelling, Markdown included |
| `make check-code` | the five above | The fast local gate |
| `make check-gen` | `pnpm i18n:check`, `pnpm codegen:check` | Drift in generated catalogs and generated GraphQL documents |
| `make check-deps` | `pnpm deps:check`, `pnpm deps:audit`, `pnpm deps:licenses` | Expo SDK drift (`expo install --check` and `expo-doctor`), high-severity vulnerabilities in production dependencies, lockfile provenance (`scripts/check-lockfile.sh`), and the license allowlist (`scripts/check-licenses.mjs`) |
| `make check-ci` | `scripts/shellcheck.sh`, `actionlint` | The CI itself: every `scripts/**/*.sh`, and the workflow files |
| `make check-docs` | `scripts/check-docs.sh` | Warns when architecture-relevant paths changed with no `docs/` change. Fails when `AGENTS.md` names a `make` target that does not exist |
| `make check-release` | `ruby -c` over the Fastfile and lanes, `fastlane lanes`, and the minitest suite in `fastlane/test/lanes_test.rb` | That the lanes parse and that their pure logic still behaves. Needs `bundle install` first, and talks to no store |

Not in `make check`, because each is slow or needs a build:

| Target | Runs |
| --- | --- |
| `make check-prebuild` | Two prebuilds into temp directories, asserting the config plugin output |
| `make bundle-secrets-check` | Exports the bundle and asserts no non-public key leaked into it |
| `make test`, `make unit`, `make coverage` | See [testing.md](testing.md) |

`make lint` and `make check-code` are what the pre-push hook and the CI
`checks` job cover between them. The CI mapping table is in [ci.md](ci.md).

## Suppressing something, correctly

Each gate has one supported escape hatch. Use it, with a comment saying why.

| Gate | Mechanism | Where |
| --- | --- | --- |
| Biome lint | `// biome-ignore lint/<group>/<rule>: <reason>` on the line above. A reason is required | The code |
| Biome, whole path | An entry in `files.includes` with a `!` prefix, or an `overrides` entry that relaxes rules for a path | `biome.json` |
| ESLint | `// eslint-disable-next-line <rule> -- <reason>` | The code |
| knip | An `ignore`, `ignoreDependencies`, `ignoreBinaries` or `ignoreUnresolved` entry, or the `knipignore` JSDoc tag on an export | `knip.json` |
| typos | An entry under `[default.extend-words]`, or a path in `extend-exclude` | `typos.toml` |
| Vulnerability audit | `auditConfig.ignoreGhsas` with the advisory id and a paragraph on why it cannot be exploited here | `pnpm-workspace.yaml` |
| Expo SDK version check | `expo.install.exclude` | `package.json` |
| `minimumReleaseAge` | `minimumReleaseAgeExclude`, pinned as `name@exact-version` so the guard still applies to later releases | `pnpm-workspace.yaml` |
| Package build scripts | `onlyBuiltDependencies` or `allowBuilds`. `strictDepBuilds` forces an explicit decision | `pnpm-workspace.yaml` |
| Coverage | Change the threshold in `jest.config.ts`, deliberately, not silently | `jest.config.ts` |

Rules of thumb: suppress the narrowest scope that works, put the reason in the
suppression itself, and never widen an ignore pattern to hide one file.

## knip runs in default mode

`make knip` runs `knip`, not `knip --strict`. Production mode resolves only the
production graph, which means it flags exports used solely by tests as unused
unless every test file is marked with `!` patterns. That trade is not worth it
here. Default mode still catches unused files, unused exports and unused
dependencies, which is the point.

There is deliberately **no** `knip` script in `package.json`. `expo-doctor`'s
"Check package.json for common issues" fails when a script name collides with
a binary in `node_modules/.bin`, and `make check-deps` runs `expo-doctor`. The
Makefile and CI both reach the binary directly, which is the supported path.
Leave it alone.

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
