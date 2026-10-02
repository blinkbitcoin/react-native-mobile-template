# Agent Skills

Agent skills that ship in this repository, each under its own subdirectory.

- **native-setup**: Setting up a laptop or CI runner for Android and iOS (`make setup`), and the symptom → cause → fix table for toolchain, build and Maestro E2E failures.

The store setup skills (`store-setup`, `store-consoles`, `store-credentials` and
`store-metadata`) are not here: they ship as the `store-release` plugin of
[blinkbitcoin/shared-workflows](https://github.com/blinkbitcoin/shared-workflows/tree/main/plugins/store-release),
which `.claude/settings.json` enables. They run against this repository the same
way, and keep their checklist in `.store-setup/state.json`.

Each skill may have tests under `<skill>/tests/run.sh`. Run all of them offline with:

```bash
make check-skills
```
