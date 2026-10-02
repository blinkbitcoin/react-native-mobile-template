# Security scanning

`make check-security` runs every enabled scanner and prints one verdict. Each
`make check-security-<job>` runs one scanner and the same verdict, so a single
scanner on a laptop still ends in the pass/fail answer CI would give.

The scanners are not in this repository. They are shared-workflows' own,
shipped in `@blinkbitcoin/app-tooling` and run here as `pnpm exec
check-security [job]`. What this repository keeps is its settings,
`security-settings.json` (every key, its default and its environment twin are
in the package's own `security-settings.json`), and the files those settings
name: the Semgrep rule for this app's own storage wrapper in `rules/`
(`jobs.code.rules`, run after the package's own React Native rules) and `.mobsf`.

In CI the same scanners run through the reusable `check-security.yml` from
shared-workflows, at the same commit as the package: the `security` job in `ci.yml` on every change, and the
`security` job in `cd-production.yml` before any store job on
`action=release`. `SECURITY_ENABLED=false` as a repository variable turns both
off.

## What runs, and where

Nine scanners, placed by what each reads: source is there on every pull
request, the built binaries only once a release is built.

| Job | Make target | Reads | Runs in CI |
| --- | --- | --- | --- |
| `dependencies` | `check-security-dependencies` | `pnpm-lock.yaml` (osv-scanner) | every pull request, every push to `main` |
| `code` | `check-security-code` | app source, `rules/` (Semgrep CE) | every pull request, every push to `main` |
| `policy` | `check-security-policy` | `pnpm-workspace.yaml` | every pull request, every push to `main` |
| `review` | `check-security-review` | the diff (an LLM, off by default) | pull requests; the release pull request reviews everything since the last release tag |
| `bundle` | `check-security-bundle` | the exported JavaScript bundle | the release pull request, and the production dispatch |
| `review-codebase` | `check-security-review-codebase` | the codebase (knostic/OpenAnt, an LLM, off by default) | the release pull request |
| `mobile` | `check-security-mobile` | a fresh prebuild of `android/` and `ios/` (mobsfscan) | the production dispatch |
| `binaries` | `check-security-binaries` | the release's `.apk` and `.ipa` (OWASP MASTG checks) | the production dispatch, before any store job |
| `sbom` | `check-security-sbom` | `pnpm-lock.yaml`; writes `.security/sbom.cdx.json` | the production dispatch |

The release pull request is the one cd-release.yml keeps open; its CI is a
`workflow_dispatch` on the `release-please--` branch, so `ci.yml` recognises it
by `github.ref_name`. On the production dispatch the store jobs wait for the
`security` job and do not start if it fails.

## Where the findings show up

On a pull request, in the `Security / *` jobs and nowhere else. The `Verdict`
job's summary carries the report, and every reportable finding is an
annotation on the diff: an error when it blocks, a warning when it is only
reported. The verdict (`security-verdict.mjs`) prints those annotations only under
`GITHUB_ACTIONS=true`, so a laptop run stays plain text.

The SARIF goes to code scanning (Security → Code scanning) from `main` only.
Every upload makes code scanning add a check per tool under GitHub's own "Code
scanning results" heading, which cannot be renamed, and on a pull request
those checks only repeated the `Security / *` jobs. Before the upload each run
is named after its job, so the tool filter reads `Dependencies`, `Code`,
`Policy` and so on rather than `osv-scanner` and `Semgrep OSS`. CodeQL's own
`Code scanning results / CodeQL` check still appears on pull requests; see
[quality.md](quality.md).

The deterministic scanners can block a run; the two LLM jobs annotate unless
`failOn` names them (see "Turning things off" below). An LLM that refuses a
prompt, or answers differently twice, must not be able to hold a release.

gitleaks and zizmor are security gates too, and unlike the scanners above they
already run in CI, inside `make check` as `check-secrets` and `check-ci`. The
line: `check` owns fast, reproducible pass/fail gates; `check-security*` owns
the SARIF-producing scanners that cost minutes.

### Where the verdict goes

One verdict, several destinations, each written by the file named:

| Destination | Written by | When |
| --- | --- | --- |
| the step log and the run summary | `verdict.sh` in shared-workflows | every run |
| annotations on the diff | `security-verdict.mjs` in the package | on a runner only (`GITHUB_ACTIONS=true`) |
| code scanning | `check-security.yml` | from `main` only |
| `.security/verdict.json` | `security-verdict.mjs` in the package | every run that reaches a verdict, laptop included (not when a SARIF file cannot be read) |

`verdict.json` is one line of JSON, for the Security badge:

```json
{"verdict":"informational","highest":"medium","canBlock":true}
```

`verdict` is the word on the summary line, `highest` its highest severity
(`none` when nothing was found), and `canBlock` says whether anything in the
run could have failed it: `false` when `severity` is `none` or `failOn` is
empty, and the badge then adds `(advisory)`. In CI, `check-security.yml` turns
the file into its `verdict` output and `ci.yml` hands that to the badges job
(see [ci.md](ci.md#badges)). Locally, `make gen-badges` reads the file from the
last `make check-security`.

### What each new scanner looks for

- **`bundle`** exports the bundle for each platform in `bundle.platforms` and
  reads its strings. A build-time or release variable's name (anything
  `.env.example` names that is not `EXPO_PUBLIC_*`) is high; a
  credential-shaped string (private key, Stripe, Google, AWS, GitHub, Slack,
  Anthropic, OpenAI) is critical; an `http://` URL is medium
  (MASTG-TEST-0233/0321) unless its host is in `bundle.cleartextHosts`; with
  `bundle.hosts` set, any other https host is low, so a new endpoint is seen.
- **`binaries`** reads the universal APK with `aapt2` and `apksigner` and the
  IPA with `plistlib` and `openssl`, and names every rule by its MASTG test:
  debuggable (0226, critical), cleartext traffic in the manifest or the network
  security config (0235), user-installed certificate authorities trusted (0286),
  v1-only signing (0224), a signing key under 2048 bits (0225), backups with no
  rules (0262), a dangerous permission not in `binaries.androidPermissions`
  (0254), an exported component with no permission not in
  `binaries.exportedComponents` (0364-0366), `get-task-allow` (0261, critical),
  App Transport Security allowing arbitrary loads or cleartext to a domain not
  in `binaries.atsExceptionDomains` (0322), and an exception below TLS 1.2
  (0342). Locally: `make check-security-binaries APK=... IPA=...`, either or
  both.
- **`mobile`** prebuilds both platforms into a temporary copy, the way
  `make check-prebuild` does, and runs mobsfscan over it. Reasoned
  suppressions live in `.mobsf`.
- **`sbom`** is a record rather than a scan: a CycloneDX bill of every
  component the lockfile pins, kept as a workflow artifact of the production
  run so a later advisory can be checked against exactly what shipped.
- **`review`** sends the diff, with the package's `security-review.prompt.md` as
  the instructions (a `security-review.prompt.md` here would be appended to it), to the configured provider and validates the answer before it
  becomes a finding: every finding must name a file in the diff, a line and a
  known severity, or the whole answer is dropped. Generated files and the
  lockfile are left out; files beyond `review.maxDiffBytes` are named as
  unreviewed rather than silently cut.
- **`review-codebase`** runs [OpenAnt](https://github.com/knostic/OpenAnt), pinned by
  commit in shared-workflows' `scripts/security/review-codebase.sh`, with dynamic (Docker) testing off.
  CI builds it from that commit; on a laptop, build it yourself and put
  `openant` on `PATH`.

## Turning the LLM jobs on

Both LLM jobs use one provider, set in the `llm` block of
`security-settings.json` or through its environment twins, and both are off
until a repository turns them on:

1. `"review": { "enabled": true }` and/or `"review-codebase": { "enabled": true }`
   under `jobs`.
2. `llm.provider`: `openai` for OpenAI or any OpenAI-compatible endpoint
   (OpenRouter, Gemini, Groq, Mistral, DeepSeek, Kimi, Qwen, GitHub Models -
   set `OPENAI_BASE_URL`), or `anthropic`. `llm.model` names the model; OpenAnt
   requires one. The [provider recipes](release-runbook.md#provider-recipes)
   give the base URL, a model and the effort for each.
3. The key as a secret: `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.

In CI, step 2 is the repository variables `SECURITY_LLM_PROVIDER`,
`SECURITY_LLM_MODEL`, `SECURITY_LLM_EFFORT`, `SECURITY_LLM_EXTRA_PARAMS` and
`OPENAI_BASE_URL`, which `ci.yml` passes through `environment-variables`, and step 3 is a
repository secret. The production dispatch carries none of them: model calls
stay out of the CD lanes, and the release pull request is where they run.

`llm.effort` (`none`, `low`, `medium`, `high`, `max`; `max` by default) is
sent to the reviewer apart from the model: Anthropic's `output_config.effort`
with adaptive thinking, or an OpenAI-compatible `reasoning_effort` (where `max`
asks for `high`, the most that schema has). `none` sends no effort field at
all, for a model with no reasoning switch, which would answer HTTP 400 to one.
Vendor-specific switches go in `SECURITY_LLM_EXTRA_PARAMS`, a JSON object
merged into the request (it may not set `model`, `messages` or `system`); a key
set to `null` removes that field, for an endpoint that rejects one of the
defaults. OpenAnt takes no effort setting.

A missing provider, key, model or prompt makes the job write "skipped" with
the reason, never "clean", and a model that does not answer, refuses, or
answers with something that does not validate does the same: a model being
down must never fail a pull request. The store-notes rewrite shares the same
adapters (`@blinkbitcoin/app-tooling/llm`, which the package's
`security-review.mjs` imports), with `STORE_NOTES_LLM_EFFORT` and
`STORE_NOTES_LLM_EXTRA_PARAMS` as its own two settings.

## Turning things off

Three layers, resolved in one order: an environment variable wins over
`security-settings.json`, which wins over the built-in default.

| To do this | Do it like this |
| --- | --- |
| Turn everything off for a repository | `SECURITY_ENABLED=false`, or `"enabled": false` in `security-settings.json` |
| Turn one scanner off | `SECURITY_CODE=false`, or `"jobs": { "code": { "enabled": false } }` |
| Change what fails a run | `"severity": "critical"`, or `SECURITY_SEVERITY=critical` |
| Give an engine class teeth | `"failOn": ["deterministic", "review"]` |
| Change one scanner's option | `"jobs": { "bundle": { "hosts": ["api.example.com"] } }`, or `SECURITY_BUNDLE_HOSTS=api.example.com` |
| Pick the LLM provider | `"llm": { "provider": "openai", "model": "kimi-k3" }`, or `SECURITY_LLM_PROVIDER` and `SECURITY_LLM_MODEL` |

Every option has an environment twin named `SECURITY_<JOB>_<KEY>`, the key in
upper snake case (`review-codebase` becomes `REVIEW_CODEBASE`):

| Option | Type | Default | Environment twin |
| --- | --- | --- | --- |
| `jobs.bundle.platforms` | list of `ios`, `android` | both | `SECURITY_BUNDLE_PLATFORMS` |
| `jobs.bundle.hosts` | list | empty (check off) | `SECURITY_BUNDLE_HOSTS` |
| `jobs.bundle.cleartextHosts` | list | `localhost`, `127.0.0.1` | `SECURITY_BUNDLE_CLEARTEXT_HOSTS` |
| `jobs.binaries.androidPermissions` | list | empty | `SECURITY_BINARIES_ANDROID_PERMISSIONS` |
| `jobs.binaries.exportedComponents` | list | empty | `SECURITY_BINARIES_EXPORTED_COMPONENTS` |
| `jobs.binaries.atsExceptionDomains` | list | empty | `SECURITY_BINARIES_ATS_EXCEPTION_DOMAINS` |
| `jobs.review.maxDiffBytes` | whole number | `200000` | `SECURITY_REVIEW_MAX_DIFF_BYTES` |
| `jobs.review-codebase.limit` | whole number, `0` for none | `0` | `SECURITY_REVIEW_CODEBASE_LIMIT` |
| `jobs.review-codebase.verify` | boolean | `false` | `SECURITY_REVIEW_CODEBASE_VERIFY` |
| `llm.provider` | `openai`, `anthropic` or empty | empty | `SECURITY_LLM_PROVIDER` |
| `llm.model` | string | empty | `SECURITY_LLM_MODEL` |
| `llm.effort` | `none`, `low`, `medium`, `high`, `max` | `max` | `SECURITY_LLM_EFFORT` |

In the environment a list is comma-separated, and an **empty** option or
`llm` twin counts as unset, so the file or the default applies: CI passes every
twin through `environment-variables`, where a repository variable nobody set arrives as an
empty string. To empty a list, set it to `[]` in the file. A value that does not parse -
not `true` or `false`, not a whole number, a list entry outside its set, an
effort or provider outside the vocabulary - fails the run rather than reading
as off, so a typo cannot silently disable a scanner. So does a key the schema
does not know (`androidPermission` for `androidPermissions`), which would
otherwise leave the real key at its default with no sign anything was wrong.
Keys starting with `$` are comments. The same is true of `severity` (must be
one of `none`, `low`, `medium`, `high`, `critical`) and of every entry in
`failOn` (must be a known engine class): a dropped letter in
`SECURITY_FAIL_ON=deterministc` fails the run, it does not quietly leave
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
confused for each other, which is why the verdict prints a different word
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
A missing tool is a skip on a laptop but a failure under `CI=true`, because a
pipeline that quietly scans nothing is worse than one that is red. The same
goes for a partial run: `binaries` without `aapt2`, or a review whose diff
outgrew `review.maxDiffBytes`, reports the part that did not run as skipped
even when the rest found nothing.

A job switched off in `security-settings.json` behaves differently in the two
places. Locally, `make check-security` still runs its script, which writes
"skipped: disabled", so with `review` and `review-codebase` off by default the local
headline reads `skipped`. In CI the job is not started at all, so it is
absent from the verdict and the headline can read `pass`.

## Suppressing a finding, correctly

Each scanner reads its own config, and every suppression carries a reason:
`osv-scanner.toml` for advisories, `.semgrepignore` and `rules/` for source
patterns, `.mobsf` for mobsfscan, `.gitleaks.toml` for secrets,
`.github/zizmor.yml` for workflows, and the allowlists under `jobs.bundle` and
`jobs.binaries` in `security-settings.json` for the bundle and binary checks.
Never raise the severity threshold to hide one finding - that hides the next
one too.

### Advisories currently accepted

These osv-scanner advisories are suppressed in `osv-scanner.toml` today, each
with no clean upgrade available. The two `image-size` ids beside them are
explained with `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`.

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
- **`node-forge@1.4.0`** (GHSA-86w9-cpqp-85rv, high) - pulled in through
  `expo` > `@expo/cli`, directly and through
  `@expo/code-signing-certificates`. No fixed release exists. Unreachable:
  only the Expo CLI loads it, on a developer machine or CI runner, and it
  verifies only signatures it made itself or certificates the developer
  configured; the shipped app checks update signatures in native code.
- **`braces@3.0.3`** (GHSA-vfj7-8cjw-p6xm, CVSS 7.5 high) - pulled in through
  `micromatch@4.0.8`, whose dependents are Metro's file map, Jest, GraphQL
  codegen, the Lingui CLI and `fast-glob`. No fixed release exists. Unreachable
  from the app: a deeply nested brace pattern only makes a build, test or
  codegen process exit, on a developer machine or CI runner, over patterns from
  the repository's own configuration.

### Accepted findings in the other scanners

- **mobsfscan `android_task_hijacking1` and `android_task_hijacking2`**
  (StrandHogg 1.0 and 2.0, CWE-1021) on `MainActivity`, suppressed in
  `.mobsf`. Expo generates the activity with `launchMode="singleTask"`, which
  expo-router's deep links rely on. The mitigation, `taskAffinity=""` through
  a config plugin, is a native change of its own and not made yet; until it
  lands this is a known, accepted risk.
- **The Android debug source sets** (`android/app/src/debug*`) are left out of
  the mobsfscan run: they allow Metro's cleartext localhost connection and are
  never part of a release variant.

See `osv-scanner.toml` for the full reasoning on each advisory: the dependency path,
why no upgrade is possible, the reachability verdict, and what upstream
change would require re-evaluating the decision.

Unlike a Semgrep or gitleaks suppression, an osv-scanner ignore leaves no
trace in run output: `osv-scanner` drops an `IgnoredVulns` match from its
SARIF entirely rather than emitting it with a suppression marker, so
the verdict has nothing to count and `make check-security-dependencies` simply
reports `dependencies: clean` - the summary line's suppressed count stays `0`
regardless. `osv-scanner.toml` and this section are therefore the only
places these two accepted risks are visible; do not read a clean `dependencies`
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

**`rn-secret-in-storage-wrapper` (`rules/app-storage-wrapper.yaml`)** reports a
credential-named key written through this template's own `storage.set` wrapper
in `src/lib/storage.ts`, which sits in front of `expo-sqlite/kv-store`. The
package's `rn-secret-in-plain-storage` rule already covers `AsyncStorage` and
`kv-store` directly, so the app's own writes would be missed without this one.
It shares that rule's naming logic, and so its two deliberate gaps: no
unqualified `key` identifier, and no fused-lowercase `authtoken` (see the shared
tooling's `docs/security.md`).

**`rules/` needs its own exclusion in every tool that discovers files by a
generic convention.** `rules/app-storage-wrapper.test.tsx` is deliberately
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

`make check-security` on this repository, with every deterministic scanner
installed and `APK` pointing at the v0.6.2 release's universal APK, reports
no finding at or above `high`, so nothing blocks:

- `dependencies`, `policy`, `bundle`, `sbom`: clean (the bill lists 1,502 components;
  the four accepted advisories above are filtered out).
- `code`: 11 Semgrep findings, the highest medium (mutable GitHub Actions
  tags, service-account strings in docs paths, the minimum-release-age policy
  pattern).
- `mobile`: 8 mobsfscan findings, the highest medium: `allowBackup` on the
  main manifest (the backup rules the app ships are what MASTG-TEST-0262
  checks, and `binaries` finds them), plus the hardening notes mobsfscan
  always raises (root detection, tapjacking, certificate transparency, pinning,
  screenshots, SafetyNet, ATS local networking).
- `binaries`: 3 medium findings, `MASTG-TEST-0254`: the release manifest asks
  for `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE` and
  `WRITE_EXTERNAL_STORAGE` (the last two capped at API 32). None is allowlisted
  in `binaries.androidPermissions`: each needs either a reason there or
  removing from the manifest, and that decision is the app owner's.

Each finding that turns out to be acceptable gets a reasoned entry in its own
scanner's configuration (see "Suppressing a finding, correctly" above), never
a raised threshold.
