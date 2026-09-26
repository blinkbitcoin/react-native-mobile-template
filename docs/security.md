# Security scanning

`make check-security` runs every enabled scanner and prints one verdict. Each
`make check-security-<job>` runs one scanner and the same verdict, so a single
scanner on a laptop still ends in the pass/fail answer CI would give.

In CI the same scripts run through the reusable `check-security.yml` from
shared-workflows: the `security` job in `ci.yml` on every change, and the
`security` job in `cd-production.yml` before any store job on
`action=release`. `SECURITY_ENABLED=false` as a repository variable turns both
off.

## What runs, and where

Nine scanners, placed by what each reads: source is there on every pull
request, the built binaries only once a release is built.

| Job | Make target | Reads | Runs in CI |
| --- | --- | --- | --- |
| `deps` | `check-security-deps` | `pnpm-lock.yaml` (osv-scanner) | every pull request, every push to `main` |
| `code` | `check-security-code` | app source, `rules/` (Semgrep CE) | every pull request, every push to `main` |
| `policy` | `check-security-policy` | `pnpm-workspace.yaml` | every pull request, every push to `main` |
| `review` | `check-security-review` | the diff (an LLM, off by default) | pull requests; the release pull request reviews everything since the last release tag |
| `bundle` | `check-security-bundle` | the exported JavaScript bundle | the release pull request, and the production dispatch |
| `openant` | `check-security-review-codebase` | the codebase (knostic/OpenAnt, an LLM, off by default) | the release pull request |
| `mobile` | `check-security-mobile` | a fresh prebuild of `android/` and `ios/` (mobsfscan) | the production dispatch |
| `binaries` | `check-security-binaries` | the release's `.apk` and `.ipa` (OWASP MASTG checks) | the production dispatch, before any store job |
| `sbom` | `check-security-sbom` | `pnpm-lock.yaml`; writes `.security/sbom.cdx.json` | the production dispatch |

The release pull request is the one cd-release.yml keeps open; its CI is a
`workflow_dispatch` on the `release-please--` branch, so `ci.yml` recognises it
by `github.ref_name`. On the production dispatch the store jobs wait for the
`security` job and do not start if it fails.

The deterministic scanners can block a run; the two LLM jobs annotate unless
`failOn` names them (see "Turning things off" below). An LLM that refuses a
prompt, or answers differently twice, must not be able to hold a release.

gitleaks and zizmor are security gates too, and unlike the scanners above they
already run in CI, inside `make check` as `check-secrets` and `check-ci`. The
line: `check` owns fast, reproducible pass/fail gates; `check-security*` owns
the SARIF-producing scanners that cost minutes.

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
- **`review`** sends the diff, with `security-review.prompt.md` as the
  instructions, to the configured provider and validates the answer before it
  becomes a finding: every finding must name a file in the diff, a line and a
  known severity, or the whole answer is dropped. Generated files and the
  lockfile are left out; files beyond `review.maxDiffBytes` are named as
  unreviewed rather than silently cut.
- **`openant`** runs [OpenAnt](https://github.com/knostic/OpenAnt), pinned by
  commit in `scripts/security/openant.sh`, with dynamic (Docker) testing off.
  CI builds it from that commit; on a laptop, build it yourself and put
  `openant` on `PATH`.

## Turning the LLM jobs on

Both LLM jobs use one provider, set in the `llm` block of
`security-policy.json` or through its environment twins, and both are off
until a repository turns them on:

1. `"review": { "enabled": true }` and/or `"openant": { "enabled": true }`
   under `jobs`.
2. `llm.provider`: `openai` for OpenAI or any OpenAI-compatible endpoint (Kimi,
   Grok, Qwen, GLM, DeepSeek, OpenRouter - set `OPENAI_BASE_URL`), or
   `anthropic`. `llm.model` names the model; OpenAnt requires one.
3. The key as a secret: `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.

In CI, step 2 is the repository variables `SECURITY_LLM_PROVIDER`,
`SECURITY_LLM_MODEL`, `SECURITY_LLM_EFFORT`, `SECURITY_LLM_EXTRA_PARAMS` and
`OPENAI_BASE_URL`, which `ci.yml` passes through `build-env`, and step 3 is a
repository secret. The production dispatch carries none of them: model calls
stay out of the CD lanes, and the release pull request is where they run.

`llm.effort` (`low`, `medium`, `high`, `max`; `max` by default) is sent to the
reviewer apart from the model: Anthropic's `output_config.effort` with
adaptive thinking, or an OpenAI-compatible `reasoning_effort` (where `max`
asks for `high`, the most that schema has). Vendor-specific switches go in
`SECURITY_LLM_EXTRA_PARAMS`, a JSON object merged into the request (it may not
set `model`, `messages` or `system`). OpenAnt takes no effort setting.

A missing provider, key, model or prompt makes the job write "skipped" with
the reason, never "clean", and a model that does not answer, refuses, or
answers with something that does not validate does the same: a model being
down must never fail a pull request. The store-notes rewrite shares the same
adapters (`scripts/lib/llm/`), with `RELEASE_NOTES_LLM_EFFORT` and
`RELEASE_NOTES_LLM_EXTRA_PARAMS` as its own two settings.

## Turning things off

Three layers, resolved in one order: an environment variable wins over
`security-policy.json`, which wins over the built-in default.

| To do this | Do it like this |
| --- | --- |
| Turn everything off for a repository | `SECURITY_ENABLED=false`, or `"enabled": false` in `security-policy.json` |
| Turn one scanner off | `SECURITY_CODE=false`, or `"jobs": { "code": { "enabled": false } }` |
| Change what fails a run | `"severity": "critical"`, or `SECURITY_SEVERITY=critical` |
| Give an engine class teeth | `"failOn": ["deterministic", "review"]` |
| Change one scanner's option | `"jobs": { "bundle": { "hosts": ["api.example.com"] } }`, or `SECURITY_BUNDLE_HOSTS=api.example.com` |
| Pick the LLM provider | `"llm": { "provider": "openai", "model": "kimi-k3" }`, or `SECURITY_LLM_PROVIDER` and `SECURITY_LLM_MODEL` |

Every option has an environment twin named `SECURITY_<JOB>_<KEY>`, the key in
upper snake case:

| Option | Type | Default | Environment twin |
| --- | --- | --- | --- |
| `jobs.bundle.platforms` | list of `ios`, `android` | both | `SECURITY_BUNDLE_PLATFORMS` |
| `jobs.bundle.hosts` | list | empty (check off) | `SECURITY_BUNDLE_HOSTS` |
| `jobs.bundle.cleartextHosts` | list | `localhost`, `127.0.0.1` | `SECURITY_BUNDLE_CLEARTEXT_HOSTS` |
| `jobs.binaries.androidPermissions` | list | empty | `SECURITY_BINARIES_ANDROID_PERMISSIONS` |
| `jobs.binaries.exportedComponents` | list | empty | `SECURITY_BINARIES_EXPORTED_COMPONENTS` |
| `jobs.binaries.atsExceptionDomains` | list | empty | `SECURITY_BINARIES_ATS_EXCEPTION_DOMAINS` |
| `jobs.review.maxDiffBytes` | whole number | `200000` | `SECURITY_REVIEW_MAX_DIFF_BYTES` |
| `jobs.openant.limit` | whole number, `0` for none | `0` | `SECURITY_OPENANT_LIMIT` |
| `jobs.openant.verify` | boolean | `false` | `SECURITY_OPENANT_VERIFY` |
| `llm.provider` | `openai`, `anthropic` or empty | empty | `SECURITY_LLM_PROVIDER` |
| `llm.model` | string | empty | `SECURITY_LLM_MODEL` |
| `llm.effort` | `low`, `medium`, `high`, `max` | `max` | `SECURITY_LLM_EFFORT` |

In the environment a list is comma-separated, and an **empty** option or
`llm` twin counts as unset, so the file or the default applies: CI passes every
twin through `build-env`, where a repository variable nobody set arrives as an
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
A missing tool is a skip on a laptop but a failure under `CI=true`, because a
pipeline that quietly scans nothing is worse than one that is red. The same
goes for a partial run: `binaries` without `aapt2`, or a review whose diff
outgrew `review.maxDiffBytes`, reports the part that did not run as skipped
even when the rest found nothing.

A job switched off in `security-policy.json` behaves differently in the two
places. Locally, `make check-security` still runs its script, which writes
"skipped: disabled", so with `review` and `openant` off by default the local
headline reads `skipped`. In CI the job is not started at all, so it is
absent from the verdict and the headline can read `pass`.

## Suppressing a finding, correctly

Each scanner reads its own config, and every suppression carries a reason:
`osv-scanner.toml` for advisories, `.semgrepignore` and `rules/` for source
patterns, `.mobsf` for mobsfscan, `.gitleaks.toml` for secrets,
`.github/zizmor.yml` for workflows, and the allowlists under `jobs.bundle` and
`jobs.binaries` in `security-policy.json` for the bundle and binary checks.
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

`make check-security` on this repository, with every deterministic scanner
installed and `APK` pointing at the v0.6.2 release's universal APK, reports
no finding at or above `high`, so nothing blocks:

- `deps`, `policy`, `bundle`, `sbom`: clean (the bill lists 1,502 components;
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
