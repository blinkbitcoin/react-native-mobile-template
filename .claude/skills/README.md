# Agent Skills

Agent skills that ship with this template, each under its own subdirectory. The four skills are:

- **store-setup**: The entry point. Picks the mode (guided, browser-pause, browser-full), keeps the resumable 41-step checklist in `.store-setup/state.json`, and holds the identifiers gate every console step waits on.
- **store-consoles**: The `apple-*` and `google-*` steps that can only happen inside App Store Connect, the Apple Developer portal, Google Play Console or Google Cloud, as exact click-paths — driven in the browser or handed to the human.
- **store-credentials**: Creates and shape-validates every credential locally (the ASC API key, the match repo, the Android upload keystore, the Play service account JSON), then pushes each one to GitHub through stdin.
- **store-metadata**: Fills `fastlane/metadata`, places the images, writes the age-rating answers, and runs the `sync_metadata` lane.

Each skill may have tests under `<skill>/tests/run.sh`. Run all tests offline with:

```bash
make check-skills
```

**Critical:** no skill file, and no file under `.store-setup/`, may hold a credential (API key, token, secret, password, certificate). `state.sh note` refuses credential-shaped keys outright — credentials go to `gh secret set` only, through stdin.
