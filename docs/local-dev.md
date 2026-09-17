# Local development

## Toolchain

Tool versions live in `.mise.toml` and are installed with
[mise](https://mise.jdx.dev):

```sh
mise trust && mise install
```

`mise trust` is needed once per clone: mise refuses to read a `.mise.toml` it
has not been told to trust.

| Tool | Pinned to | Needed by |
| --- | --- | --- |
| node | 24 | the app, Metro, every script |
| pnpm | 12 | installs. Any other package manager is refused by `only-allow pnpm` |
| java | temurin-17 | Gradle and Maestro |
| ruby | 3.3 | fastlane and CocoaPods |
| actionlint | 1.7.12 | `make check-ci` |
| shellcheck | 0.11.0 | `make check-ci` |
| typos | 1.50.1 | `make spell` |

`typos` is pinned rather than `latest` so this repo and
`shared-workflows` can never disagree about what counts as a typo.

mise's `[env]` block also exports `EXPO_NO_TELEMETRY=1` and `APP_PORT_BASE`
(see [Ports](#ports)), puts `node_modules/.bin` on `PATH` (so `biome`, `eslint`
and `expo` run without a `pnpm exec` prefix), and loads `.env.local` if you have
one — a gitignored file for per-machine overrides. There is no `.envrc`: see
[decisions/0007-mise-not-nix.md](decisions/0007-mise-not-nix.md) for why direnv
is not a second mechanism here.

Then check the rest of the machine:

```sh
make doctor
```

`scripts/doctor.mjs` reads `scripts/doctor.requirements.json` and reports
node, pnpm, java, ruby, watchman, xcodebuild (macOS, 26.4+), pod (macOS),
adb, and maestro (optional), plus the `ANDROID_HOME` environment variable and
`bundle check` (the fastlane gems `make check-release` needs — `make install`
installs them). Each failure prints its own fix hint. Run it before asking
anyone why a build fails.

## First run

```sh
make install      # pnpm deps, Ruby gems (vendor/bundle) and the git hooks
make ports        # what every port will be (see "Ports" below)
make mock-api     # terminal 1: the GraphQL mock API
make start        # terminal 2: Metro for the dev client
make ios          # terminal 3: prebuild if needed, build, launch the simulator
make android      # or the Android emulator
```

`make web` starts the Expo web dev server instead, and `make build-web`
produces the static export in `dist/`.

Environment defaults come from `.env.development` (committed, all public
values). `.env.example` is the documented list of every variable, public and
build-time. Only `EXPO_PUBLIC_*` reaches app code; see
[architecture.md](architecture.md).

The first `make ios` or `make android` runs a prebuild and, on iOS, a pod
install, so it takes a while. Later runs are incremental.

## Ports

Nothing here hardcodes a port. Every one is `APP_PORT_BASE` (default `8080`)
plus a fixed offset, so a second worktree of this repo runs side by side with
the first by moving a single variable:

| Variable | Default | Offset | What listens |
| --- | --- | --- | --- |
| `APP_PORT_BASE` | `8080` | — | the base every other port derives from |
| `METRO_PORT` | `8081` | +1 | Metro / the Expo dev server (`make start`) |
| `MOCK_API_PORT` | `8082` | +2 | the graphql-yoga mock API (`make mock-api`) |
| `WEB_PREVIEW_PORT` | `8083` | +3 | `expo serve dist`, the Playwright preview server (web target) |

Metro's offset is `+1` on purpose: `8081` is Expo's own default and the port the
`expo-development-client` deep link assumes, so the default base leaves every
existing instruction true.

`scripts/ports.mjs` is the table, and it is the only thing that derives a port.
`.mise.toml`'s `[env]` exports `APP_PORT_BASE` — the *input* — and nothing else;
the Makefile's run targets `eval "$(node scripts/ports.mjs --sh)"` to get the
three *outputs*. Keeping one producer is not tidiness: a mirrored
`METRO_PORT=8081` sitting in the environment is indistinguishable from a
deliberate override, and `APP_PORT_BASE=8090` would then quietly do nothing.

So the three service variables are normally unset, and setting one by hand
(`MOCK_API_PORT=4444 make mock-api`) means exactly what it says — override this
one service, leave the rest on the base. Run `make ports` to see what any
combination resolves to.

To run a second worktree alongside this one:

```sh
git worktree add ../rnmt-feature -b feature origin/main
cd ../rnmt-feature && mise trust
APP_PORT_BASE=8090 make ports      # 8091 / 8092 / 8093
APP_PORT_BASE=8090 make mock-api   # 8092
APP_PORT_BASE=8090 make start      # 8091
```

`EXPO_PUBLIC_API_URL` is the one value that is *not* exported by mise either:
Expo bakes it into the bundle, so `.env.development` carries the mock API's
default URL for a bare `expo start`, and the Makefile's run targets export the
derived one over it.

`scripts/ports.test.mjs` (`pnpm test:scripts`) greps the tracked tree for a bare
port literal and fails naming the file. If a new file genuinely needs one, add
it to `ALLOWED` there with a reason.

## The dev client and the deep link

This app uses `expo-dev-client`, not Expo Go. `make start` runs
`expo start --dev-client`.

The dev client's launcher screen discovers Metro over Bonjour, and Bonjour does
not work on a simulator or an emulator. Waiting for a "DEVELOPMENT SERVERS"
entry there is waiting forever. Open the app through the deep link instead:

```sh
eval "$(node scripts/ports.mjs --sh)"   # $METRO_PORT; see "Ports" above

# iOS simulator
xcrun simctl openurl booted "rnmt://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$METRO_PORT"

# Android emulator
adb shell am start -a android.intent.action.VIEW \
  -d "rnmt://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A$METRO_PORT"
```

`scripts/e2e/maestro-ios.sh` and `scripts/e2e/maestro-android.sh` do exactly
this before running the flows, and CI does the same. See
[ci.md](ci.md) for the CI half.

## Android and `10.0.2.2`

The emulator reaches the host machine at `10.0.2.2`, not `localhost`. Two
places handle it:

- `src/config/env.ts` rewrites `://localhost` to `://10.0.2.2` in
  `EXPO_PUBLIC_API_URL` when running in development on Android.
- `scripts/e2e/maestro-android.sh` runs `adb reverse` for `$METRO_PORT` and
  `$MOCK_API_PORT` so Metro and the mock API are reachable by their host ports
  too.

A physical Android device needs neither: use `adb reverse` yourself, or point
`EXPO_PUBLIC_API_URL` at the host's LAN address.

## Prebuild and native debugging

`ios/` and `android/` are generated and gitignored. **Never commit them.**
Regenerate them locally only when you are debugging a config plugin:

```sh
make prebuild        # expo prebuild --clean, writes ios/ and android/
make check-prebuild  # prebuilds both platforms into a temp dir and asserts the plugin output
```

`make check-prebuild` is **not** part of `make check` — it runs two full
prebuilds, which is too slow for the static gate (see
[quality.md](quality.md)); run it yourself before pushing a native change. It
never touches your `./ios` or `./android`: it copies the repo into a temp directory twice,
once with OTA off and once with `OTA_ENABLED=true`, and greps the generated
projects for the plugin output. `make clean` removes the generated projects
and the caches; `make reset` also reinstalls `node_modules`.

The prebuild-diff workflow for a plugin change is in
[native-extensions.md](native-extensions.md).

## Git hooks

`pnpm install` runs `lefthook install` through the `prepare` script, so the
hooks in `lefthook.yml` are active after `make install`. (`make install` also
runs `bundle install` into `vendor/bundle`; `NO_BUNDLE=1 make install` skips
that half.)

| Hook | Runs |
| --- | --- |
| `pre-commit` | Biome check with `--write` on staged files, ESLint on staged `src/**/*.{ts,tsx}`, typos on staged files |
| `commit-msg` | commitlint on the message |
| `pre-push` | `pnpm typecheck`, `pnpm knip`, and Jest limited to what changed since `origin/main` |
| `post-merge`, `post-checkout` | Reinstall dependencies when the lockfile changed between the two revisions |

Escape hatches, for when a hook is wrong and you know why:

```sh
git commit --no-verify     # skip pre-commit and commit-msg
LEFTHOOK=0 git push        # skip pre-push
LEFTHOOK=0 git commit      # skip every hook for one command
```

CI runs the same checks, so an escape hatch defers work, it does not remove it.

For a standing personal tweak, write `lefthook-local.yml` instead — it is
gitignored and merges over `lefthook.yml`, so your workaround does not become
everyone's. `pre-commit` is skipped outright during a merge or a rebase: those
commits already passed the hook once.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Metro serves stale JS, or a module resolves oddly | `pnpm start --clear`, or `make clean` for the caches and generated projects |
| `Watchman` errors, or file changes are not picked up | `watchman watch-del-all`, then restart Metro. `make doctor` checks watchman is installed |
| iOS build fails on a pod that was just added | `make prebuild`, which reruns pod install, or delete `ios/` and let `make ios` regenerate it |
| `expo-doctor` complains about a package version | `pnpm expo install --check` is the fix path. `make check-deps` runs both.<br>Genuine exceptions go in `expo.install.exclude` in `package.json` |
| A `pnpm install` fails on a package that is too new | `minimumReleaseAge` in `pnpm-workspace.yaml` is 1 day.<br>Wait, or add an exact `name@version` entry to `minimumReleaseAgeExclude` with a comment saying why |
| `Cannot find native module 'HelloNative'` | You are on web or in Expo Go. Build a dev client: `make ios` or `make android` |
| The app cannot reach the API on Android | The emulator needs `10.0.2.2`. See above |
| The dev client sits on its launcher screen | Open the `expo-development-client` deep link. See above |
| Type errors in `src/graphql/generated/` | Do not edit it. Run `make codegen`.<br>It imports `@graphql-typed-document-node/core`, which is why that package is a direct dependency |
| A release Android build dies in `createBundleReleaseJsAndAssets` with "Cannot find module 'babel-preset-expo'" | `publicHoistPattern` in `pnpm-workspace.yaml` exists for this. Do not remove that entry. See [quality.md](quality.md) |
| `make check-release` says to run `bundle install` | You skipped the Ruby half of `make install` (`NO_BUNDLE=1`, or an older clone).<br>Re-run `make install`. Ruby gems are not committed |

## Editors

The repo commits `.editorconfig` (LF, UTF-8, two-space indent, tabs in the
`Makefile`, four spaces in Swift, Kotlin and Gradle files) and no editor
settings. Biome reads it, through `formatter.useEditorconfig`.

For VS Code or Cursor, install the Biome extension and the ESLint extension,
set Biome as the default formatter, and turn format-on-save on. The two are
not interchangeable here: Biome formats and does the generic linting, ESLint
only carries React and Expo semantic rules. The ownership split is in
[quality.md](quality.md).

TypeScript path aliases (`@/*` to `src/*`) come from `tsconfig.json`, so any
editor using the workspace TypeScript version resolves them without extra
configuration.
