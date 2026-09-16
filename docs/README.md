# Documentation index

Start here. Every page below is kept next to the code it describes, and every
`make` target it quotes is one the repo actually has (`make help` lists them
all).

## Which doc when

| You want to... | Read |
| --- | --- |
| Get the app running on a simulator or emulator for the first time | [local-dev.md](local-dev.md) |
| Understand the folder layout, data flow, providers and env model | [architecture.md](architecture.md) |
| Know which linter owns a rule, or why a gate failed | [quality.md](quality.md) |
| Write a test, add a Maestro flow, or read a failed CI run | [testing.md](testing.md) |
| Add a native capability, a config plugin or a local Expo module | [native-extensions.md](native-extensions.md) |
| Wire a crash reporter, or find the OTA and crash-reporting overview | [ota-and-crash-reporting.md](ota-and-crash-reporting.md) |
| Turn OTA updates on, publish a hotfix, or roll one back | [ota.md](ota.md) |
| Get a store account, create credentials, and know what each one can reach | [store-accounts.md](store-accounts.md) |
| Cut a release, promote a build, halt a rollout, or rehearse a lane | [release-runbook.md](release-runbook.md) |
| Understand what CI runs, how it maps to `make`, and where the logs are | [ci.md](ci.md) |
| Know why a choice was made and what the alternatives were | [decisions/README.md](decisions/README.md) |
| Turn this template into your own app | [template-usage.md](template-usage.md) |

## One line each

| Doc | Contents |
| --- | --- |
| [architecture.md](architecture.md) | Folder map, the routes-only rule, data flow, config and env flow, provider order,<br>error handling, storage split, the updates channel model |
| [local-dev.md](local-dev.md) | Toolchain via mise, `make doctor`, first run, the dev-client deep link, prebuild debugging, a troubleshooting table |
| [quality.md](quality.md) | Biome and ESLint ownership, every gate in `make check`, how to suppress a rule correctly, commit conventions, git hooks |
| [testing.md](testing.md) | The test layers, coverage rules, RNTL notes, adding a Maestro flow, Playwright, forensics artifacts |
| [native-extensions.md](native-extensions.md) | Config plugin vs local Expo module vs build properties,<br>the `hello-native` and `with-build-stamp` walkthroughs, capability recipes |
| [ota-and-crash-reporting.md](ota-and-crash-reporting.md) | The `CrashReporter` adapter slot, Sentry and Crashlytics recipes, where dSYMs live, pointer to the OTA doc |
| [ota.md](ota.md) | The `OTA_ENABLED` toggle, code signing, the update server, the channel model, the fingerprint gate, hotfix and rollback |
| [store-accounts.md](store-accounts.md) | Apple, Google, Huawei and Samsung: account signup, which credential to create,<br>what each one can reach, and the repo secret it becomes |
| [release-runbook.md](release-runbook.md) | The six steps of a release, versions and build numbers, store notes, secrets, environments, verification gates, `DRY_RUN=1` |
| [ci.md](ci.md) | The workflow callers, how CI maps to `make`, the dev-client launch mechanism, forensics artifacts, workflow pinning |
| [decisions/README.md](decisions/README.md) | The ADR index: one short record per locked decision |
| [template-usage.md](template-usage.md) | What `make init` renames and removes when you adopt the template |
| [web-files.txt](web-files.txt) | The list of web-only files, read by `make init` when web is declined. Data, not prose |

## Elsewhere in the repo

| Path | Contents |
| --- | --- |
| `AGENTS.md` | The canonical rules-of-the-road file for humans and coding agents. `CLAUDE.md` includes it |
| `mocks/README.md` | The mock GraphQL schema, the yoga server and the MSW handlers that share it |
| `certs/README.md` | The expo-updates code-signing certificate and key handling |
| `deploy/ota/README.md` | The self-hosted update server deployment |
| `docs/superpowers/` | The specs and plans this template was built from. History, not a guide |
