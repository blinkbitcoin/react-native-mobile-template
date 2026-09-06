# Security policy

## Reporting a vulnerability

Report privately. Do **not** open a public issue, and do not describe the
problem in a pull request.

- Preferred: GitHub → **Security** → **Report a vulnerability** (private
  security advisory) on this repository.
- Email: `security@blink.sv` *(placeholder — replace with the real address for
  your fork before publishing this repository)*.

Include the affected version or commit, the platform (iOS/Android/web), and the
smallest set of steps that reproduces the issue. Expect an acknowledgement
within a few working days. Please give us a reasonable window to ship a fix
before disclosing publicly; a coordinated fix usually rides an over-the-air
update or an expedited store release (see
[`docs/ota.md`](docs/ota.md) and [`docs/release-runbook.md`](docs/release-runbook.md)).

## Supported versions

Only `main` and the most recent release are supported. Older builds get no
backported fixes — an affected user is expected to take the current store or
OTA update.

## Secrets policy

- **Nothing secret goes in the repository.** Signing material (`*.jks`,
  `*.keystore`, `*.p8`, `*.p12`, `*.key`, `*.mobileprovision`, `*.pem`),
  service-account JSON and `fastlane/.env*` are gitignored. The one committed
  `.pem` is the public expo-updates code-signing *certificate* (`certs/`), which
  is public by design.
- **Nothing secret reaches the app bundle.** Only `EXPO_PUBLIC_*` variables are
  readable at runtime, they are parsed by `src/config/env`, and everything in
  them ships to users in cleartext. `make bundle-secrets-check` exports the
  bundle and fails if a non-public key leaks into it.
- **Runtime credentials go through `src/lib/secure-store`** (Keychain /
  Keystore), never `expo-secure-store` directly and never
  `src/lib/storage` (unencrypted key-value).
- **CI and release credentials** live in GitHub Environments and organisation
  secrets, scoped per environment, rotated on team changes. The authoritative
  list — which variable belongs to which environment, and why the release flow
  uses a GitHub App rather than a PAT — is in
  [`docs/release-runbook.md`](docs/release-runbook.md).
- If a secret is committed or otherwise exposed, treat it as compromised:
  rotate first, then clean up history.

Dependency exposure is watched by `make check-deps` (audit, lockfile provenance,
licenses) and by Dependabot (`.github/dependabot.yml`).
