# Agent Skills

Agent skills that ship with this template, each under its own subdirectory. The four skills are:

- **store-setup**: Interactive guide to create and link app store accounts (Apple, Google, etc).
- **console-walkthroughs**: Guided troubleshooting for common development issues.
- **credential-validation**: Verify that account credentials are configured correctly.
- **store-metadata**: Sync and validate store metadata for iOS and Android.

Each skill may have tests under `<skill>/tests/run.sh`. Run all tests offline with:

```bash
make check-skills
```

**Critical:** No skill file may hold a credential (API key, token, secret, password, certificate). These are loaded from env, secure stores, or the `.store-setup/` index—never embedded in skill code.
