---
name: store-credentials
description: Use when creating, checking or wiring store credentials for this app - an App Store Connect API key, a fastlane match repository, an Android upload keystore, a Google Play service account, the App Review contact - or when deciding which of them go to GitHub as variables versus secrets.
allowed-tools: Bash(.claude/skills/store-credentials/scripts/*.sh *) Bash(.claude/skills/store-credentials/tests/run.sh) Bash(gh variable *) Bash(gh secret *)
---

# Store Credentials

## Overview

This skill covers the `cred-*` ids in the `store-setup` checklist:
`cred-asc-key`, `cred-match`, `cred-upload-keystore`, `cred-play-json`, and
`cred-push`, the step that wires everything into GitHub.

**Core principle:** every credential is validated for shape on this machine
before a macOS minute is spent, and reaches GitHub only through stdin.
`gh variable set NAME --body-file -` and `gh secret set NAME --body-file -`
both read the value from standard input; nothing here ever puts a value on
a command line, in an argv a process list can see, or in this skill's own
stdout.

## Ask First

- `validate-play-json.sh --check-access` makes a real network call (fastlane
  asks Google to validate the service account) — confirm before running it,
  or pass `--yes`.
- `push-to-github.sh --apply` changes the target repository's GitHub
  variables/secrets — confirm before running it; the script itself also
  refuses to run without `--yes`.
- Never run `fastlane match nuke` from this skill or suggest it as a fix —
  see Red Flags.

## Procedure per Credential

### `cred-asc-key` — App Store Connect API key

```bash
.claude/skills/store-credentials/scripts/validate-asc-key.sh \
  --p8 AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --issuer-id <uuid>
```

Or, once it is already base64'd for the GitHub secret:

```bash
.claude/skills/store-credentials/scripts/validate-asc-key.sh \
  --base64 asc_key.b64 --key-id XXXXXXXXXX --issuer-id <uuid>
```

Checks the key is a PKCS#8 EC key on the `prime256v1` (P-256) curve — not
the PKCS#1 RSA shape a stray re-export sometimes produces — and that the
key id / issuer id look like what Apple actually issues.

### `cred-match` — fastlane match certificates repository

```bash
.claude/skills/store-credentials/scripts/validate-match-repo.sh \
  --git-url <url> [--basic-auth <base64 of user:token>]
```

Refuses (exit 2) a `--git-url` equal to `state.facts.production_match_git_url`
— that repo is not for rehearsing against. Warns, without failing, if
`REPO_ROOT/certs` already exists on disk from an earlier `fastlane match`
run.

### `cred-upload-keystore` — Android upload keystore

```bash
.claude/skills/store-credentials/scripts/new-upload-keystore.sh \
  --out certs/upload.keystore --alias upload
```

`certs/` must already be in `.gitignore` (it is, in this template) — the
script refuses to write anywhere `git check-ignore` does not cover, and
refuses an existing file without `--force`. It never prints a password:
generated store/key passwords are written once to `<out>.storepass` /
`<out>.keypass` for you to move into a password manager and delete.

Already have a keystore? Validate it instead:

```bash
ANDROID_UPLOAD_KEYSTORE_PASSWORD=... ANDROID_UPLOAD_KEY_PASSWORD=... \
  .claude/skills/store-credentials/scripts/validate-keystore.sh \
  --keystore certs/upload.keystore --alias upload
```

### `cred-play-json` — Google Play service account key

```bash
.claude/skills/store-credentials/scripts/validate-play-json.sh \
  --file play-service-account.json
```

Add `--check-access` (network — see Ask First) to also run fastlane's
`validate_play_store_json_key` against it.

### `cred-push` — wire everything into GitHub

```bash
# Preview only — reads gh variable/secret list, writes nothing:
.claude/skills/store-credentials/scripts/push-to-github.sh --plan

# Apply from a local env file (see the script's usage comment for its
# "<variable|secret> NAME=value" format):
.claude/skills/store-credentials/scripts/push-to-github.sh \
  --apply --yes --from-env-file /path/outside/the/repo/creds.env \
  --env production

# After a toggle flips true, check nothing it needs is still missing:
.claude/skills/store-credentials/scripts/push-to-github.sh --verify
```

Keep the env file outside the repository (or somewhere already
`.gitignore`d) and delete it once `--apply` finishes.

## Variables versus Secrets

`push-to-github.sh`'s own class table is authoritative (a test asserts it
matches `docs/release-runbook.md`'s "Variables and secrets" tables
exactly). In short: variables are non-sensitive — visible in every log —
and everything else is a secret, including all seven `APP_REVIEW_*` values
(a reviewer demo login is a real credential, even though the lanes also
accept it through `env-json`-style input elsewhere).

| | Variables (28) | Secrets (21) |
|---|---|---|
| Visible in logs | Yes | No (masked) |
| Set with | `gh variable set NAME --body-file -` | `gh secret set NAME --body-file -` |
| Can scope to an environment | Rarely needed | Yes — `internal`/`beta`/`production`, via `--env` |
| Examples | `IOS_BUNDLE_ID`, `STORE_UPLOADS_ENABLED`, `E2E_IOS` | `ASC_KEY_P8_BASE64`, `MATCH_PASSWORD`, `APP_REVIEW_EMAIL` |

## After Editing the Scripts

```bash
.claude/skills/store-credentials/tests/run.sh
```

Uses real `openssl` and, when present, real `keytool` — no network, no real
`gh`, no real GitHub repository. Run it after touching any script here, and
again as part of `make check` before committing.

## Common Mistakes

| Mistake | Consequence |
|---|---|
| Pasting a base64 secret with embedded newlines straight into `--base64` | `validate-asc-key.sh` strips newlines before decoding, so this is fine — but a hand-typed `gh secret set` without that stripping is not |
| Downloading the OAuth-client JSON instead of the service-account key from Play Console | `validate-play-json.sh` catches it: "that is an OAuth client, not a service account key" |
| Putting a new keystore anywhere outside `.gitignore`'s `certs/` | `new-upload-keystore.sh` refuses (exit 2) rather than risk a committed keystore |
| Running `gh secret set NAME "$VALUE"` by hand | The value lands in shell history and the process list; use `--body-file -` and pipe the value in, as every script here does |

## Red Flags — Stop

- About to run `fastlane match nuke` (or suggest it) — it revokes every
  certificate on the team, breaking every other developer and CI job that
  match serves; there is never a good reason to reach for it from this
  skill
- About to echo, `cat`, or otherwise print a password, `.p8` key, or
  service-account JSON to the terminal
- About to run `push-to-github.sh --apply` without having shown the human
  the `--plan` output first
