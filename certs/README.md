# expo-updates code signing

`expo-updates-cert.pem` is the **public** code-signing certificate for OTA
updates. `app.config.ts` points `updates.codeSigningCertificate` at it whenever
`OTA_ENABLED=true`, so the client refuses any update manifest that was not
signed by the matching private key.

The certificate is public by design and is committed on purpose — it is the
single `*.pem` exception in `.gitignore`. **The private key is never
committed.**

## The certificate in this repo

The committed certificate was generated for the template so that an
`OTA_ENABLED=true` prebuild works out of the box (see
`scripts/check-prebuild.sh`). **Its private key was generated and then
immediately discarded**, so this certificate cannot sign anything. It is a
placeholder: it proves the wiring, not the trust chain.

Generate your own pair before you ship OTA updates.

## Generating a pair

```bash
npx expo-updates codesigning:generate \
  --key-output-directory ./keys \
  --certificate-output-directory ./certs \
  --certificate-validity-duration-years 10 \
  --certificate-common-name "RN Mobile Template"
mv certs/certificate.pem certs/expo-updates-cert.pem
```

This writes `keys/private-key.pem`, `keys/public-key.pem` and the certificate.
`keys/` is gitignored.

Then:

1. Commit **only** `certs/expo-updates-cert.pem`.
2. Store `keys/private-key.pem` in the release secret store (it is what signs
   update manifests at publish time) and delete the local copy.
3. Roll the pair before the validity duration expires — a client with an
   expired certificate stops accepting updates.

`updates.codeSigningMetadata` in `app.config.ts` (`keyid: 'main'`,
`alg: 'rsa-v1_5-sha256'`) must match the key id and algorithm used when
signing; the defaults above produce exactly those.
