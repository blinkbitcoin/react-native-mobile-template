# Security scanning

`make check-security` runs every enabled scanner and prints one verdict.
**Nothing in `.github/workflows/` calls it today.** `ci.yml` calls
`check-code`, `check-unit` and `check-e2e`; the only security-flavoured
workflow that exists is the pre-existing, unrelated `ci-codeql.yml`. The
reusable `check-security.yml` workflow and its call sites in this repository
are a later, separate stage that cannot land until `v0` in shared-workflows
carries the file. Until that stage merges, these three scanners run **only**
when a human or an agent types `make check-security*` on a laptop; `main`
and every pull request are not yet protected by them.

## What runs, and where

| Scanner | Make target | Reads | Runs |
| --- | --- | --- | --- |
| osv-scanner | `check-security-deps` | `pnpm-lock.yaml` | local only (`make check-security-deps`) |
| Semgrep CE | `check-security-code` | app source, `rules/` | local only (`make check-security-code`) |
| pnpm policy | `check-security-policy` | `pnpm-workspace.yaml` | local only (`make check-security-policy`) |

gitleaks and zizmor are security gates too, and unlike the three above they
already run in CI, inside `make check` as `check-secrets` and `check-ci` -
they are fast and binary, so putting them there cost nothing. The line for
the rest is: `check` owns reproducible pass/fail gates that already run in
CI, `check-security*` owns the SARIF-producing scanners that cost minutes and
are, for now, local-only.

## Turning things off

Three layers, resolved in one order: an environment variable wins over
`security-policy.json`, which wins over the built-in default.

| To do this | Do it like this |
| --- | --- |
| Turn everything off for a repository | `SECURITY_ENABLED=false`, or `"enabled": false` in `security-policy.json` |
| Turn one scanner off | `SECURITY_CODE=false`, or `"jobs": { "code": { "enabled": false } }` |
| Change what fails a run | `"severity": "critical"`, or `SECURITY_SEVERITY=critical` |
| Give an engine class teeth | `"failOn": ["deterministic", "review"]` |

A value that is not `true` or `false` fails the run rather than reading as
off, so a typo cannot silently disable a scanner. The same is true of
`severity` (must be one of `none`, `low`, `medium`, `high`, `critical`) and
of every entry in `failOn` (must be a known engine class): a dropped letter
in `SECURITY_FAIL_ON=deterministc` fails the run, it does not quietly leave
nothing able to block.

An **empty** `failOn` (`SECURITY_FAIL_ON=`, or `"failOn": []`) is different -
it is a legitimate choice for a consumer who wants every scanner advisory
only, so it is allowed. But nothing can block with an empty `failOn`,
whatever severity turns up, so the summary line says so explicitly
(`failOn is empty: nothing can block`) rather than letting the run read as an
ordinary pass.

## Reading the summary line

The last line of every run is one of four words, in order of how bad the
news is:

| Headline | Meaning |
| --- | --- |
| `security: fail` | A finding at or above the threshold came from an engine class in `failOn`. Exit code 1. |
| `security: informational` | Findings exist, none of them blocking (below the threshold, or from an engine class not in `failOn`). Exit code 0. |
| `security: skipped` | No blocking or reportable findings, but at least one job did not run (a missing tool, a disabled job).<br>Exit code 0 - nothing ran, so nothing could have blocked - but this is not the same claim as `pass`. |
| `security: pass` | Every job ran, and found nothing reportable. Exit code 0. |

`pass` is a claim that the whole gate ran and found nothing; `skipped` is a
claim that most or all of it did not run at all. Turning a scanner off -
`SECURITY_CODE=false`, a missing tool on a laptop with no `mise install`,
`SECURITY_ENABLED` left set from a previous run - trades `pass` for
`skipped` for as long as that job stays off, and the two must never be
confused for each other, which is why `verdict.mjs` prints a different word
for each rather than folding `skipped` into `pass` once nothing is left to
report.

The line also carries a suppressed count: `N suppressed` names how many
results a scanner's own config already dropped (`osv-scanner.toml`,
`.semgrepignore`, an inline marker) - dropped from blocking correctly, but
counted rather than vanishing without a trace, so a suppression stays
distinguishable from a vulnerability nobody ever found.

## Skipped is not clean

A scanner with nothing to scan - no tool installed, no binary, no key - writes
a SARIF whose run says `executionSuccessful: false` and carries the reason.
The verdict prints `skipped: <reason>` for it and never counts it as clean.
This is designed so that, once a pipeline calls these scripts, a missing
tool is a skip on a laptop but a failure under `CI=true`, because a pipeline
that quietly scans nothing is worse than one that is red. No workflow
exercises that `CI=true` path today - see the note at the top of this file.

## Suppressing a finding, correctly

Each scanner reads its own config, and every suppression carries a reason:
`osv-scanner.toml` for advisories, `.semgrepignore` and `rules/` for source
patterns, `.gitleaks.toml` for secrets, `.github/zizmor.yml` for workflows.
Never raise the severity threshold to hide one finding - that hides the next
one too.

### Advisories currently accepted

Two osv-scanner advisories are suppressed in `osv-scanner.toml` today, both
with no clean upgrade available:

- **`uuid@7.0.3`** (GHSA-w5hq-g745-h8pq, CVSS 7.5 high) - pulled in through
  `expo` > `@expo/config-plugins` > `xcode@3.0.1`, which hard-pins the dead
  7.x line. Unreachable: the only call is `uuid.v4()` during `expo prebuild`,
  never in the shipped app, and `v4()` is not even an affected function.
- **`decode-uri-component@0.2.2`** (GHSA-vcc3-ghjq-m6fr, CVSS 6.6 medium) -
  pulled in through `expo-router` > `query-string@7.1.3`, which cannot take
  the ESM-only 0.5.0 fix without breaking its own `require()` call. Unlike
  the entry above, this one **is** reachable at runtime through
  `query-string.parse()` on an incoming deep link - a denial-of-service
  surface the owner has knowingly accepted, not one ruled out as unreachable.

See `osv-scanner.toml` for the full reasoning on each: the dependency path,
why no upgrade is possible, the reachability verdict, and what upstream
change would require re-evaluating the decision.

Unlike a Semgrep or gitleaks suppression, an osv-scanner ignore leaves no
trace in run output: `osv-scanner` drops an `IgnoredVulns` match from its
SARIF entirely rather than emitting it with a suppression marker, so
`verdict.mjs` has nothing to count and `make check-security-deps` simply
reports `deps: clean` - the summary line's suppressed count stays `0`
regardless. `osv-scanner.toml` and this section are therefore the only
places these two accepted risks are visible; do not read a clean `deps`
run, on its own, as nothing being carried.

## Known limitations

**The Semgrep registry packs are not content-pinned.** `code.sh` pulls
`p/typescript`, `p/secrets` and `p/owasp-top-ten` from the Semgrep registry by
name; only the `semgrep` binary version is pinned. Registry rule content can
therefore drift between a laptop and a CI run over time, even with the same
binary version, because the registry packs update independently upstream.
This setup does not offer the same bit-for-bit reproducibility as `rules/`,
which is versioned in this repository. Treat a new Semgrep finding with no
matching source change as a possible pack update, not necessarily a
regression. It also means `code.sh` needs network access every run - fetching
`p/typescript`, `p/secrets` and `p/owasp-top-ten` from the Semgrep registry is
what `--config p/...` does. `--metrics off` only stops telemetry; it does not
make the run offline.

**`rn-secret-in-async-storage` (`rules/react-native-secrets.yaml`) has two
deliberate gaps.** It does not match an unqualified `key` identifier, so
`keyExtractor` and `sortKey` are not reported - only identifiers that read as
a credential, such as `apiKey` or `authToken`, trigger the rule. It also does
not match a fused-lowercase identifier such as `authtoken`: the rule looks for
a word boundary between the credential word and the rest of the name, so
`authToken` and `auth_token` match but `authtoken` does not. Both are
precision trade-offs against false positives on ordinary React Native code,
not coverage gaps to be closed by loosening the pattern.

**`rules/` needs its own exclusion in every tool that discovers files by a
generic convention.** `rules/react-native-secrets.test.tsx` is deliberately
uninstantiable snippet code in Semgrep's own `<rule-id>.test.tsx` fixture
convention, scanned by `semgrep --test rules/`, never meant to run as
anything else. Four tools currently exclude `rules/` for that reason, each
with a one-line comment: `tsconfig.json`'s `exclude`, `biome.json`'s
`files.includes` (`!rules`), `eslint.config.mjs`'s `globalIgnores`
(`rules/**`), and `jest.config.ts`'s `testPathIgnorePatterns`
(`<rootDir>/rules/`). All four are anchored to the repository root, on
purpose: a consumer's own `src/rules/` - an unrelated directory name they are
free to use for anything - must stay linted, type-checked and tested
normally, not silently skipped because it happens to share a name with this
repository's Semgrep fixtures. Colocating a rule with its fixture is the
Semgrep convention worth keeping, so moving `rules/` out from under the app
source tree would relocate this problem rather than remove it. A fifth tool
added later that walks the repository by a similar convention will likely
need the same one-line, root-anchored treatment - check for it before
assuming a new fixture file "just works".

## The current baseline

A first `make check-security` run on this repository finds 11 Semgrep
findings (6 mutable GitHub Actions tags, 3 service-account strings in docs
paths, 2 minimum-release-age policy findings) and 2 osv-scanner advisories:
`uuid@7.0.3` (CVE-2026-41907, CVSS 7.5, high) and `decode-uri-component@0.2.2`
(CVSS 6.6, medium). Because a high-severity advisory exists, `make
check-security` currently fails (`verdict.mjs` exits 1; Make reports its own
generic nonzero status on top of that). That is the gate working, not a bug -
each finding needs a reasoned ignore in its own scanner's config (see
"Suppressing a finding, correctly" above), never a raised threshold.
