# Security scanning

`make check-security` runs every enabled scanner and prints one verdict. Each
`make check-security-<job>` runs one scanner and the same verdict, so a single
scanner on a laptop still ends in the pass/fail answer CI would give.

The scanners are not in this repository. They are shared-workflows' own,
shipped in `@blinkbitcoin/app-tooling` and run here as `pnpm exec
check-security [job]`. What each one reads, where the findings and the verdict
go, every setting with its environment twin, the LLM jobs and the known limits
of the scanners are on the shared page:
[security.md in shared-workflows](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/security.md).
This page holds only what is this app's own choice.

## What this repository keeps

| File | What it holds |
| --- | --- |
| `security-settings.json` | The settings: which jobs run, the severity threshold, the Android permission<br>and bundle allowlists. Every key and its default are in the package's own file |
| `rules/` | The Semgrep rule for this app's storage wrapper, run after the package's React Native rules<br>(`jobs.code.rules`) |
| `osv-scanner.toml` | Accepted dependency advisories, each with its reasoning |
| `.mobsf` | Accepted mobsfscan findings |
| `.gitleaks.toml` | Allowlisted test data for the secret scan |
| `.github/zizmor.yml` | Accepted workflow findings |

In CI the same scanners run through the reusable `check-security.yml`, at the
same commit as the package: the `security` job in `ci.yml` on every change and
the one in `cd-production.yml` before any store job on `action=release`.
`SECURITY_ENABLED=false` as a repository variable turns both off. The two LLM
reviews are off in `security-settings.json` until you set `llm.provider` and a
key.

## Suppressing a finding, correctly

Each scanner reads its own configuration, and every suppression carries a
reason: `osv-scanner.toml` for advisories, `.semgrepignore` and `rules/` for
source patterns, `.mobsf` for mobsfscan, `.gitleaks.toml` for secrets,
`.github/zizmor.yml` for workflows, and the allowlists under `jobs.bundle` and
`jobs.binaries` in `security-settings.json` for the bundle and binary checks.
An entry with no reason is not mergeable. Never raise the severity threshold
to hide one finding: that hides the next one too.

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

## This app's own scanner notes

**`rn-secret-in-storage-wrapper` (`rules/app-storage-wrapper.yaml`)** reports a
credential-named key written through this template's `storage.set` wrapper in
`src/lib/storage.ts`, which sits in front of `expo-sqlite/kv-store`. The
package's `rn-secret-in-plain-storage` rule covers `AsyncStorage` and
`kv-store` directly, so the app's own writes would be missed without this one.
It shares that rule's two deliberate gaps: no unqualified `key` identifier, and
no fused-lowercase `authtoken`.

**`rules/` needs its own exclusion in every tool that discovers files by a
generic convention.** `rules/app-storage-wrapper.test.tsx` is deliberately
uninstantiable snippet code in Semgrep's `<rule-id>.test.tsx` fixture
convention. Four tools exclude `rules/` for that reason, each with a comment:
`tsconfig.json`'s `exclude`, `biome.json`'s `files.includes` (`!rules`),
`eslint.config.mjs`'s `globalIgnores` and `jest.config.ts`'s
`testPathIgnorePatterns`. All four are anchored to the repository root, so an
adopter's own `src/rules/` stays linted and tested. A new tool that walks the
repository by convention needs the same one-line, root-anchored entry.

## The current baseline

`make check-security` here, with every deterministic scanner installed and
`APK` pointing at a release's universal APK, reports no finding at or above
`high`, so nothing blocks. The findings below that line:

- `dependencies`, `policy`, `bundle`, `sbom`: clean (the accepted advisories
  above are filtered out).
- `code`: Semgrep findings, the highest medium (mutable GitHub Actions tags,
  service-account strings in docs paths, the minimum-release-age policy pattern).
- `mobile`: mobsfscan findings, the highest medium: `allowBackup` on the main
  manifest, plus the hardening notes mobsfscan always raises.
- `binaries`: three medium `MASTG-TEST-0254` findings, the release manifest's
  `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE`.
  None is allowlisted in `binaries.androidPermissions`: each needs a reason
  there or removal from the manifest, and that decision is the app owner's.

A finding that turns out to be acceptable gets a reasoned entry in its own
scanner's configuration, as above, never a raised threshold.
