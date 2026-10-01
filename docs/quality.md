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
| zizmor | Workflow security: template injection, permissions, App token scope, dangerous triggers | `.github/zizmor.yml` |
| gitleaks | Secrets committed anywhere in the git history | `.gitleaks.toml` |
| commitlint | Commit and PR-title conventions | `commitlint.config.mjs` |
| pnpm | Dependency provenance, release age, allowed builds, audit exceptions | `pnpm-workspace.yaml` |
| osv-scanner | Known vulnerabilities and malicious-package records in the lockfile | `osv-scanner.toml` |
| Semgrep | Mobile-specific source patterns and the registry TypeScript/secrets/OWASP packs | `rules/`, `.semgrepignore` |
| pnpm install policy scanner | The install-time supply-chain settings, asserted rather than trusted | `pnpm-workspace.yaml` |
| pnpm sbom | A CycloneDX bill of materials from the lockfile | `security-settings.json` (`jobs.sbom`) |
| Bundle scanner | Private variable names, credential-shaped strings and cleartext URLs in the exported bundle | `security-settings.json` (`jobs.bundle`) |
| mobsfscan | Mobile-specific misconfiguration in a fresh prebuild of `android/` and `ios/` | `.mobsf` |
| Binary checks | OWASP MASTG tests over the release's built APK and IPA | `security-settings.json` (`jobs.binaries`) |
| LLM reviewer and codebase review (OpenAnt) | Security review of the diff, and an LLM scan of the codebase; both off by default | `security-review.prompt.md`, `security-settings.json` (`llm`) |

The scanners from osv-scanner down are `make check-security*`, run separately
from `make check` because they are external CLIs and cost minutes; see
[security.md](security.md) for what each reads, where each runs, how to turn
one off, and how to suppress a finding correctly.

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

`make check` = `check-code` + `check-generated` + `check-expo-health` +
`check-audit` + `check-licenses` + `check-ci` + `check-docs` + `check-release` +
`check-secrets`.

| Target | Runs | Owns |
| --- | --- | --- |
| `make check-types` | `tsc --noEmit` | Types. `strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,<br>`verbatimModuleSyntax`, `noImplicitOverride`, `noFallthroughCasesInSwitch` |
| `make check-lint` | `biome lint .` then `eslint . --max-warnings=0` | Lint, both halves. Warnings are failures |
| `make check-format` | `biome format .` | Formatting. `make fix-format` writes |
| `make check-unused` | `knip`, with the ports exported | Unused files, exports, dependencies |
| `make check-spell` | `typos` | Spelling, Markdown included |
| `make check-code` | the five above | The fast local gate |
| `make check-generated` | `pnpm check:generated`: shared-workflows' `checks/generated.sh`, which runs `gen:i18n`<br>and `gen:graphql` | Drift in generated catalogs and generated GraphQL documents, an untracked new catalog included |
| `make check-expo-health` | `pnpm check:expo-health`: shared-workflows' `checks/expo-health.sh` | Expo SDK drift (`expo install --check` is advisory, a CI warning),<br>then `expo-doctor`, whose other checks block |
| `make check-audit` | `pnpm check:audit`: `pnpm audit --audit-level=high --prod`, then `check-lockfile` | High-severity vulnerabilities in production dependencies, and lockfile provenance |
| `make check-licenses` | `pnpm check:licenses`: `check-licenses` | Every production dependency's license against the organisation's allowlist |
| `make check-ci` | shared-workflows' `ci/check-ci.sh` (actionlint, `zizmor --offline --min-severity medium`<br>with `.github/zizmor.yml`, shellcheck over `scripts/` and `.claude/skills/`, all at the pinned versions),<br>`check-shell-locale`, `check-workflow-names --group ci=CI --group cd=CD`,<br>`check-ignored-directories` | The CI itself: every shell script, and the workflow files.<br>Fails when a tool that walks the tree stops skipping `.workflows/` or `.claude/worktrees/`<br>([below](#worktrees-inside-the-checkout-are-not-this-checkout)).<br><br>zizmor allows tag pins by policy and ignores one reviewed `workflow_run` (`.github/zizmor.yml`).<br>Fails on a `LC_ALL=C cmd` locale prefix in any tracked shell code (Makefile and workflow `run:` blocks included),<br>and on a workflow file or display name outside the `ci`/`cd` groups (see `AGENTS.md`).<br>The three guards come from `@blinkbitcoin/app-tooling` |
| `make check-docs` | `check-docs` from `@blinkbitcoin/app-tooling`, which runs `check-make-target-names`,<br>`check-docs-tables` and `check-diagrams`; its rules are the `docs` section of `app-tooling.json` | Warns when architecture-relevant paths changed with no `docs/` change.<br>Fails when `AGENTS.md`'s command table and the Makefile's `##`-documented targets disagree in either direction,<br>when a make target is named after the tool it runs,<br>when a markdown table cell has a line wider than 120 visible characters,<br>or when a fenced `mermaid` block does not parse |
| `make check-release` | `ruby -c` over the Fastfile and lanes, `fastlane lanes`, the minitest suite in `fastlane/test/lanes_test.rb`,<br>and every `.claude/skills/*/tests/run.sh` | That the lanes parse and that their pure logic still behaves,<br>and that the store skills still agree with the fastlane gem.<br>Needs the Ruby gems `make install` installs, and talks to no store |
| `make check-secrets` | shared-workflows' `checks/secrets.sh`: `gitleaks git` over the whole history,<br>at the pinned version, refusing a shallow clone | No committed secret, including one deleted in a later commit.<br>Test data that must look real is allowlisted in `.gitleaks.toml`, each entry with its reason |

Not in `make check`, because each is slow or needs a build:

| Target | Runs |
| --- | --- |
| `make check-slow` | The two below, grouped. Off by default in CI too (`check.yml`'s `prebuild`, `check-security.yml`'s `bundle`) |
| `make check-prebuild` | Two prebuilds into temp directories, asserting the config plugin output |
| `make check-security-bundle` | Exports the bundle and fails on a private variable name or a credential-shaped string in it<br>(the `bundle` scanner; [security.md](security.md)) |
| `make check-code-scanning` | CodeQL's `security-and-quality` suite over the whole tree — see below |
| `make test`, `make test-unit`, `make test-coverage`, `make test-scripts` | See [testing.md](testing.md); the last is `node:test` with a 100% coverage gate over `scripts/**/*.mjs` |

## `make check` is the CI gate set, and that is enforced

`make check` runs the gates the `check` workflow runs. `make ci` adds the
`test-unit` workflow's — coverage and the script tests — and is the one-command
local CI run:

```sh
make ci     # everything CI runs except E2E
```

E2E is the deliberate exception: it needs a simulator or an emulator, so it
stays in `make test-e2e-ios`, `make test-e2e-android` and `make test-e2e-web`.

**This is checked, not asserted.** It used to be asserted — the Makefile headed
this section "each is what CI runs" — while four gates ran here and in no CI job
at all: i18n drift, GraphQL document drift, lockfile provenance and the licence check. A
green `make check` was making a claim about coverage CI was not providing, and
nothing detected it.

The `Checks / Contract` job, the first job of every CI run, reads this repo's
`Makefile` and callers against the contract of the shared-workflows version
`ci.yml` pins, and fails in both directions:

- a script CI calls that `make ci` cannot reach;
- a target `make ci` reaches that no CI step runs, such as a check that runs
  only in `make test-coverage`.

It is this repo's PR that fails, never shared-workflows': that repo defines the
contract and never checks out a consumer. So adding a gate here means adding
its CI step, and vice versa. To run the same check before pushing, run
`make check-contract`: the checker comes from `@blinkbitcoin/app-tooling`, a git
dependency on shared-workflows at the commit the workflows pin, so it is the
same code CI runs
([ADR 0024](decisions/0024-shared-tooling-at-the-workflows-pin.md)).

### How a gate gets into CI

The reusable workflows call the consumer's **package scripts**, never `make`
directly — requiring a Makefile with exact target names would make the workflows
unusable for consumers that have none. A package script may wrap a make target,
and several here do: `check:docs`, `check:release`, `check:ci` and
`check:secrets` are each `make <target>`. That is how make ends up
running in CI: the package script is the interface, make is the implementation.

For five gates — the generated files, the Expo health check, the audit, the
CI linters and the secrets scan — `shared-workflows` prefers this repo's script
and falls back to its own only if we ship none. For the generated files, the
Expo health check, secrets and the CI linters ours call the shared scripts
themselves, from `@blinkbitcoin/app-tooling` at the workflows pin, so the local
gate and CI's are the same code; `scripts/gates.test.mjs` pins those calls.

### Why CI is not one `make check` step

It would guarantee parity trivially, and it was rejected. The `check` workflow
runs each gate as its own step, which buys three things a single step loses: the
per-gate workflow inputs, which are a documented consumer interface; the audit
step's own `timeout-minutes` and its advisory-on-PR behaviour; and per-step
timing in the run UI. Parity is worth having, but not at the price of the
controls that make a red run diagnosable.

The gates are already grouped into a handful of jobs by what they need (Code,
Generated, Docs, Dependencies, Release, CI, Secrets, Commits), each with one
checkout and one `pnpm install`. A job per gate would pay that setup again for
gates that mostly take seconds.

`make check-lint` and `make check-code` are what the pre-push hook and the CI
`checks` job cover between them. The CI mapping table is in [ci.md](ci.md).

## What `make check-docs` checks

CI runs the same thing through the `check:docs` package script, which the
workflows repo's `check.yml` calls when its `docs` input is on (the default). Before
that input existed this gate ran on no CI job at all — it was a local-only
courtesy, which is how a stale command table could reach `main`.

| Check | Fails on | Escape hatch |
| --- | --- | --- |
| Freshness | nothing — it warns | Touch `docs/`, or ignore the warning deliberately |
| Command table | `AGENTS.md` and the Makefile's `##`-documented targets disagreeing in either direction | None. Fix whichever side is wrong |
| Make target names | a documented target with a word that names a tool pinned in `.mise.toml` or an unscoped package | Rename the target; an exception is an entry in<br>`docs.allowTargetNames` in `app-tooling.json`, target to reason |
| Table width | a markdown table cell line wider than 120 visible characters | Break the cell with `<br>`; 120 is the default of `check-docs-tables` (`@blinkbitcoin/app-tooling`) |
| Mermaid | a fenced `mermaid` block the parser rejects | Fix the diagram. There is no ignore |

The freshness warning reads a `package.json` change as architectural only when
a non-dependency key moved — `scripts`, `engines`, `packageManager`,
`expo.install.exclude`, the package identity — so a version or dependency bump
never asks for a docs update, and a Dependabot PR (`PR_AUTHOR`) is exempt
outright. The architecture-relevant paths are the `docs.architecture` list in
`app-tooling.json`.

Its diff base comes from the event: a `pull_request` compares against
`origin/$BASE_REF`, any other CI event against `HEAD~1`, and a local run
against `origin/main`. CI checks out at depth 1 and two depth-1 tips share no
common ancestor, so the script deepens the fetch (`--deepen=50`, then one
`--unshallow` if that was not enough) before diffing — without it this warning
could never fire in CI at all, which is what it did for its first round. When
the base still cannot be resolved the check **says so** with a `::notice::`
rather than passing quietly, because silence here is indistinguishable from
"nothing to warn about".

Table width is 120, not the 72 the sibling repos use: theirs is tuned for the
narrow README column npm renders, while these tables are read on GitHub at full
page width. Measured on this repo, 72 flags 117 lines while 120 flags only the
ones that actually squeeze a neighbouring column until its code spans wrap.

**The mermaid check is the one gate that needs the network**, on a cold `npx`
cache: it runs a pinned `@mermaid-js/mermaid-cli` rather than vendoring a
parser. When the CLI cannot be fetched or its browser cannot launch, the check
skips with a warning instead of blocking an offline developer — but **only off
CI**. A runner has both the network and a browser, so a probe failure there is
the gate itself breaking, and it exits non-zero with an `::error::` annotation.
The earlier version warned on the runner too, which meant every diagram merged
unchecked for as long as nobody read the log. Locally the check only looks at
docs that changed against `origin/main`; CI passes `--all`.

Rendering goes through puppeteer, which needs a Chromium to drive, and `npx`
fetches the CLI without reliably fetching a browser with it. So the script
looks for one the machine already has — `PUPPETEER_EXECUTABLE_PATH`,
`CHROME_BIN` (GitHub runner images export it), then the usual Linux and macOS
install paths — and hands `mmdc -p` a puppeteer config naming it, with
`--no-sandbox --disable-dev-shm-usage` for the container case. Finding none, it
names no executable and puppeteer falls back to its own download.

Whether the toolchain works is decided **once, up front**, by rendering a
known-good diagram the script owns (`PROBE_DIAGRAM`) — never by reading the
parser's complaints. The first cut sniffed `mmdc`'s stderr for words like
"network" and "command not found" to tell an offline `npx` from a broken
diagram, but `mmdc` echoes the diagram source back in its errors, so any
malformed diagram mentioning one of those words classified itself as an
environment problem and switched the gate off. A gate whose subject can turn it
off is not a gate; deciding availability before any doc is read is what makes
that impossible.

## Suppressing something, correctly

Each gate has one supported escape hatch. Use it, with a comment saying why.

| Gate | Mechanism | Where |
| --- | --- | --- |
| Biome lint | `// biome-ignore lint/<group>/<rule>: <reason>` on the line above. A reason is required | The code |
| Biome, whole path | An entry in `files.includes` with a `!` prefix, or an `overrides` entry that relaxes rules for a path | `biome.json` |
| ESLint | `// eslint-disable-next-line <rule> -- <reason>` | The code |
| knip | An `ignore`, `ignoreDependencies`, `ignoreBinaries` or `ignoreUnresolved` entry, or the `knipignore` JSDoc tag on an export | `knip.json` |
| typos | An entry under `[default.extend-words]`, or a path in `extend-exclude` | `typos.toml` |
| Vulnerability audit | `auditConfig.ignoreGhsas`, one comment **per id** — the advisory, the dependency path that pulls it in,<br>why it is unreachable from app code, and what should make us look again | `pnpm-workspace.yaml` |
| Expo SDK version check | `expo.install.exclude` | `package.json` |
| `minimumReleaseAge` | `minimumReleaseAgeExclude`, pinned as `name@exact-version` so the guard still applies to later releases | `pnpm-workspace.yaml` |
| `trustPolicy: no-downgrade` | `trustPolicyExclude`, pinned as `name@exact-version` with a reason - pnpm compares publish dates<br>across every major of a package, so a later, stronger release can still read as this one having downgraded | `pnpm-workspace.yaml` |
| Package build scripts | `onlyBuiltDependencies` or `allowBuilds`. `strictDepBuilds` forces an explicit decision | `pnpm-workspace.yaml` |
| Coverage | Change the threshold in `jest.config.ts` or the `--test-coverage-*` flags of `test:scripts`,<br>deliberately, not silently | `jest.config.ts`, `package.json` |
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
[the workflows' consumer guide](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/consumer-guide.md)),
so an ignore added to get a PR green is an ignore that was never needed.

## CodeQL, and why suppression is a source comment

CodeQL runs two ways from one config file, `.github/codeql/codeql-config.yml`:
`.github/workflows/ci-codeql.yml` hands that path to
`github/codeql-action/init`, and `make check-code-scanning` parses the suite, the packs and
the `paths-ignore` list out of the same file. One file, so a local "clean" and a
CI "clean" mean the same thing.

It is **advanced setup**, not GitHub's Default setup, precisely so those choices
are files in this repository that a reviewer sees in a diff rather than toggles
on a settings page. It is **informational**: leave `codeql` out of the required
checks, because a pack download that times out must not be able to block a
merge. Alerts land under Security → Code scanning.

`make check-code-scanning` needs a CodeQL CLI, which nothing else here does and `make check`
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

`make check-unused` runs `knip`, not `knip --strict`. Production mode resolves only the
production graph, which means it flags exports used solely by tests as unused
unless every test file is marked with `!` patterns. That trade is not worth it
here. Default mode still catches unused files, unused exports and unused
dependencies, which is the point.

The script is `check:unused`, never `knip`. `expo-doctor`'s "Check
package.json for common issues" fails when a script name collides with a binary
in `node_modules/.bin`, and `make check-expo-health` runs `expo-doctor`. The
Makefile and the pre-push hook both run `pnpm check:unused`, which calls the
binary. Naming the script for the gate rather than the tool is the family's
rule anyway (`check:<stem>` for a gate, `gen:<stem>` for a generator).

The script exports the ports before it calls knip:
`eval "$(node scripts/ports.mjs --sh)" && knip`. knip's Playwright plugin
loads `playwright.config.ts` to find the specs under `e2e/web/`, and that
config throws when `WEB_PREVIEW_PORT` is unset — deliberately, so a real run
never guesses a port. knip only logs "Error loading playwright.config.ts" and
still exits 0, with the specs no longer entries and `e2e/web/` unanalysed.
`e2e/**/*.ts` is in knip's `project`, so an unused export there is reported,
and `eval` is in `ignoreBinaries` because knip does not know the shell
builtin. `scripts/check-unused-web.test.mjs` runs `pnpm check:unused` with
the ports unset and fails on an "Error loading" line.

## Worktrees inside the checkout are not this checkout

Claude Code creates git worktrees under `.claude/worktrees/<name>/`, inside the
repository. Each is a whole checkout with its own `node_modules`, so a tool that
walks the tree finds a second copy of every file. Without an exclusion, Jest
runs every worktree's suites too and fails with "Invalid hook call" (a second
React), and ESLint reports errors in files nobody changed.

`.git/info/exclude` hides the directory from git, but it is per clone and not
every tool reads it, so each one names it itself:

| Tool | Where | Entry |
| --- | --- | --- |
| Jest (both projects) | `jest.config.ts` | `<rootDir>/\.claude/worktrees/` in `testPathIgnorePatterns`,<br>`modulePathIgnorePatterns` and `coveragePathIgnorePatterns` |
| Metro | `metro.config.js` | a `resolver.blockList` entry, anchored to the project root |
| ESLint | `eslint.config.mjs` | `.claude/worktrees/**` in `globalIgnores` |
| Biome | `biome.json` | `!!.claude/worktrees` in `files.includes` |
| knip | `knip.json` | none: its globs skip dot-directories and it reads `.gitignore`;<br>an `ignore` entry only draws a "Remove from ignore" hint |
| tsc | `tsconfig.json` | `.claude/worktrees` in `exclude` |
| typos | `typos.toml` | `.claude/worktrees/` in `extend-exclude` |
| Semgrep | `.semgrepignore` | `.claude/worktrees/` |
| CodeQL | `.github/codeql/codeql-config.yml` | `paths-ignore` (and so `make check-code-scanning`'s index filters) |
| git | `.gitignore` | `/.claude/worktrees/` |

Jest and Metro match absolute paths, and a worktree's own root is itself under
`.claude/worktrees/`. An unanchored pattern such as `/\.claude/worktrees/` would
therefore ignore every test, or the whole app, when run *from* a worktree; both
entries are anchored to the root for that reason. Biome's entry is `!!` rather
than `!` so its scanner never indexes the directory either: otherwise it finds
the worktree's `biome.json` and stops with "Found a nested root configuration".

The reverse problem hits a tool that looks for its configuration somewhere
other than the working directory: run from a worktree, it can read the outer
checkout's settings instead of this one's. zizmor does exactly that. It looks
for `zizmor.yml` or `.github/zizmor.yml` at the repository root, which it takes
to be the nearest directory holding a `.git` *directory*, and a worktree's
`.git` is a file. So it reads the outer checkout's policy, or none at all if
that branch has no `.github/zizmor.yml`. With no policy, `unpinned-uses` comes
back on and fails every tag-pinned workflow. `make check-ci` therefore names the
file with `--config .github/zizmor.yml`. Biome, ESLint, typos and shellcheck
also walk up for theirs, but they start from the working directory or the file
being checked. So they find the worktree's own file before they reach the outer
checkout.

Each of these tools also skips `.workflows/`, since every CI job checks shared-workflows out there (see
[ci.md](ci.md#workflows)). `check-ignored-directories` (from
`@blinkbitcoin/app-tooling`, run by `make check-ci`) holds both directories'
entries in place. It checks the Jest, Metro and ESLint entries by what
they match, loading this repository's own configuration, and the rest by what
their files say. It also fails on a zizmor command without the `--config` flag.
A new tool that walks the tree adds its entry here, and, when the shared check
does not know the tool yet, an assertion upstream. So does a tool that
discovers its configuration.

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
