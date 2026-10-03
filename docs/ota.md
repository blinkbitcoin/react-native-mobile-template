# Over-the-air updates

OTA ships a JavaScript-only change to already-installed apps without a store
review. It is **off by default** in this template, and turning it on is a
deliberate act: an update reaches every installed app on the channel within one
launch and cannot be recalled once downloaded.

The pipeline is the family's and is described once, in
[ota.md in shared-workflows](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/ota.md):
[the flow](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/ota.md#the-flow),
[the channel model](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/ota.md#the-channel-model),
[the fingerprint gate](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/ota.md#the-fingerprint-gate),
[hotfix](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/ota.md#hotfix) and
[rollback](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/ota.md#rollback).
The reference update server, a Docker Compose deployment with its
reverse-proxy, storage and backup notes, is
[`deploy/ota/`](https://github.com/blinkbitcoin/shared-workflows/tree/main/deploy/ota)
there too. This page holds what this app sets. The store path is
[release-runbook.md](release-runbook.md); code-signing keys are in
[../certs/README.md](../certs/README.md).

## The toggle

One variable, `OTA_ENABLED`, read in three places:

| Place | Effect when `OTA_ENABLED` is not `true` |
| --- | --- |
| `app.config.ts` | `updates: { enabled: false }`: no URL, certificate or update check is compiled into the binary |
| `.github/workflows/cd-{internal,beta,production}.yml` | the callers pass `ota-enabled: vars.OTA_ENABLED == 'true'`; the pipeline skips its OTA job |
| `.github/workflows/cd-ota-hotfix.yml` | the publish job is skipped |

A repository variable is never automatically an environment variable, so the
callers forward `OTA_ENABLED` and `EXPO_UPDATES_URL` through their
`environment-variables` input. Without that, the binary would compile with
updates off while the OTA jobs published happily, and no installed app would
ever receive an update. Leaving OTA off is a supported end state.

## Enabling it

1. **Generate your own code-signing key pair.** The certificate committed at
   `certs/expo-updates-cert.pem` is a placeholder whose private key was
   discarded, so it can never sign anything. Replace it before you publish an
   update:

   ```bash
   npx expo-updates codesigning:generate \
     --key-output-directory ./keys \
     --certificate-output-directory ./certs \
     --certificate-validity-duration-years 10 \
     --certificate-common-name "Your App"
   mv certs/certificate.pem certs/expo-updates-cert.pem
   ```

   Commit only `certs/expo-updates-cert.pem`. The private key goes in the update
   server's secret store (`EOO_PRIVATE_KEY`); delete the local copy (`keys/` is
   gitignored). `updates.codeSigningMetadata` in `app.config.ts` (`keyid: 'main'`,
   `alg: 'rsa-v1_5-sha256'`) matches what that command produces. Rolling the pair
   later needs a new store build, because a client trusts only the certificate
   baked into its binary.
2. **Deploy the update server** from the reference deployment linked above.
3. **Set the variables and secrets**, then ship a store build. An update can
   only reach a binary compiled with `OTA_ENABLED=true` and the right
   certificate; turning the variable on does not retrofit apps in the field.

| Name | Kind | Value |
| --- | --- | --- |
| `OTA_ENABLED` | repo variable | `true` |
| `EXPO_UPDATES_URL` | repo variable | the server's public origin, byte-identical to its `EOO_BASE_URL` |
| `OTA_CLI_VERSION` | repo variable | the exact `eoas` version; the publish script refuses to run unpinned |
| `OTA_PUBLISH_TOKEN` | secret, per environment | one of the server's `EOO_TOKENS` |

Scope `OTA_PUBLISH_TOKEN` to the `internal`, `beta` and `production` GitHub
Environments, so a leaked internal token cannot publish to production.
`EXPO_UPDATES_URL` also feeds the post-publish manifest check, which fails a
publish that serves nothing.

## What is specific to this app

**One binary, three channels.** The binary bakes `expo-channel-name:
production` (`app.config.ts`, `updates.requestHeaders`), and internal and beta
testers run that same binary. They reach the other channels at runtime, through
`updates.switchChannel('beta')` in `src/services/updates.ts`, wired to the
hidden developer menu. It is for development and QA only, and the override is
per install and does not survive a reinstall.

**The runtime version is the native fingerprint.** `runtimeVersion` is
`{ policy: 'fingerprint' }`, computed with this repository's `@expo/fingerprint`
and `fingerprint.config.js`, so a binary is only offered updates built from a
matching native layer. A change to `plugins/`, `modules/` or a native
dependency is therefore never a hotfix: the gate rejects it, and you cut a store
build instead.

**Hotfix.** Run Actions, then **CD / OTA Hotfix** with a `channel`, a `ref` and
a `rollout` (default `10`); production waits for the `production` environment's
reviewer, exactly like a store release.

**Unverified.** The `eoas publish` flags and whether it reads
`OTA_PUBLISH_TOKEN` by that name, and the image and `EOO_*` names of the
reference server, were written offline. Confirm them against the pinned CLI
(`npx eoas@<version> publish --help`) and the server's README on first real use,
and fix the shared scripts and pages together.
