# Testing

Five runners, each with a job. Nothing here needs a network.

## The layers

| Layer | Runner | Lives in | Run with |
| --- | --- | --- | --- |
| Unit (pure TS) | Jest, `app` project (jest-expo) | `src/**/*.test.ts` | `make test-unit` |
| Component | Jest, RNTL 14 | `src/**/*.test.tsx` | `make test-unit` |
| Router | Jest, `renderRouter` from `expo-router/testing-library` | `src/__tests__/app/**` (one per route),<br>`src/features/**` | `make test-unit` |
| Apollo with a real schema | Jest, MSW over the `mocks/` executable schema | anything that renders a query | `make test-unit` |
| Native module wrapper | Jest, the manual mock in `modules/hello-native/src/__mocks__/` | `modules/hello-native/index.test.ts` | `make test-unit` |
| Config plugins | Jest, `plugins` project (plain node) | `plugins/*.test.ts` | `make test-unit` |
| Node scripts | `node:test` | `scripts/**/*.test.mjs` | `make test-scripts` |
| Shared app suites | `node:test`, shipped in `@blinkbitcoin/app-tooling` | none here: they read this app's files | `make test-app` |
| Fastlane lanes | minitest, in shared-workflows | none here: the Fastfile only imports them | `make check-release` |
| E2E, native | Maestro | `.maestro/flows/` | `make test-e2e-ios`, `make test-e2e-android` |
| E2E, web | Playwright | `e2e/web/` | `make test-e2e-web` |

`make test` is `make test-unit` plus `make check-code`. `make test-coverage` is what CI
enforces.

## One test file per module

Every source file has its own test file beside it, and that file alone covers
the module at 100% (lines, branches, functions, and statements where the tool
measures them):

| Module | Its test |
| --- | --- |
| `scripts/init.mjs` | `scripts/init.test.mjs` |
| `src/components/Card.tsx` | `src/components/Card.test.tsx` |
| `src/i18n/i18n.ts` | `src/i18n/i18n.test.tsx` (a `.ts` module may be tested in JSX) |
| `src/features/settings/NativeDemoCard.web.tsx` | `src/features/settings/NativeDemoCard.web.test.tsx` |
| `modules/hello-native/index.ts` | `modules/hello-native/index.test.ts` |
| `src/app/details/[id].tsx` | `src/__tests__/app/details/[id].test.tsx` |

Global coverage only says each line ran in some test. A module reached only
through a caller's test is uncovered the day that caller changes, and nothing
fails when it happens. So a directory-wide test file, a `__tests__/`
directory, or a module's tests living in a caller's file does not count, even
at 100% globally. A test that spans several modules is welcome on top, but it
is extra, never the module's own test.

**Routes are the one exception to "beside".** expo-router loads every
`.ts(x)` file under `src/app/` as a route, test files included: one there
would be bundled into the app and registered as a route, and a `+`-prefixed
one crashes the router. Expo's own testing guide says to keep tests out of the
app directory. A route's test therefore mirrors its path under
`src/__tests__/app/`. Route tests import the route through `@/app/...` and
render it with `renderRouter`, against the real `src/app` tree when the route
is a layout or a screen mount, or against an inline route map when only the
route's own logic is under test.

Check one module against its own test before pushing:

```sh
node --test --experimental-test-coverage --test-coverage-include=scripts/init.mjs scripts/init.test.mjs
pnpm exec jest src/components/Card.test.tsx --coverage --collectCoverageFrom=src/components/Card.tsx
```

Jest applies the global 100% thresholds to the one file it measures, so the
second command fails below 100%.

`check-test-siblings` (from `@blinkbitcoin/app-tooling`, the first step of
`make test-scripts`) enforces that the sibling exists. It reads the tracked
files, plus untracked ones git does not ignore, and names every one without a
sibling. Its rules are the `testSiblings` section of `app-tooling.json`. In
scope: `scripts/**/*.mjs`, `src/**/*.ts(x)`, `plugins/*.ts` and
`modules/*/index.ts`. Out of scope: test files, `*.d.ts`,
`src/graphql/generated/`, `src/i18n/locales/` and `src/test/` (the harness,
which has its own tests anyway). The same check fails on a test file under
`src/app/` and on a route test whose route was renamed or deleted (the
`mirror` rule, `src/app/` to `src/__tests__/app/`). An exclude must be a glob
or a directory; one naming a single file is refused as the allowlist entry it
would be. There is no
allowlist and no exception: a file that needs a device, a simulator, a native
build or the network is tested against fakes of them, and the check fails if
an allowlist comes back. That the one file covers its
module at 100% is not measured per file by CI, so review holds it, with the
commands above.

### The two Jest projects

`jest.config.ts` calls `createJestConfig` from the shared Expo preset
(`@blinkbitcoin/app-tooling/expo/jest`) with this app's paths, and the preset
defines them:

- `app`: the `jest-expo` preset, this app's `src/test/env.ts` and
  `src/test/setup.ts`, the `@/*` path alias, and the preset's stand-ins for
  `expo-secure-store`, `expo-sqlite/kv-store` and `expo-updates`. It ignores
  `/plugins/`, `/e2e/`, `/scripts/` and `/rules/` (Semgrep's own
  `<rule-id>.test.tsx` fixture convention, asserted by `semgrep --test rules/`,
  never a Jest suite).
- `plugins`: plain node, matching `plugins/**/*.test.ts`. Config plugins run
  inside the Expo CLI, not in a React Native runtime, so they get no preset.
  Its only setup file is the console guard below.

`collectCoverageFrom`, `coverageReporters` and `coverageThreshold` are global,
which is why they sit at the top level and not in either project.
`coveragePathIgnorePatterns` is the exception — see [Coverage](#coverage).

### `pnpm test:scripts`

`test-scripts`, the shared tooling's runner (`@blinkbitcoin/app-tooling`), covers
the tooling that has no business booting React Native, and fails below 100% — see
[Script coverage](#script-coverage). It runs `check-test-siblings` first (see
[One test file per module](#one-test-file-per-module)), then `node --test` with
coverage over `scripts/**/*.test.mjs`, gated to this repository's own
`scripts/**/*.mjs` (what `testScripts` in `app-tooling.json` names, by default
those two globs), so a test that runs shared-workflows' scripts from `$WORKFLOWS_DIR`
is not measured. The suites include:

| Suite | Covers |
| --- | --- |
| `scripts/init.test.mjs` | The template rename and web-removal script behind `make init` |
| `scripts/ci-suite-gates.test.mjs` | `ci.yml`'s `unit`, `e2e` and `badges` jobs evaluated together for each kind of change, and `unit` held to having<br>no gate (see [ci.md](ci.md#skipping-a-suite-the-change-cannot-affect)) |

These run in `make ci` (and in CI's Unit job), **not** in `make check`, which
is the static gates only. The port guard in `scripts/port-pins.test.mjs` and the
`make init` manifest coverage live here, so a change that passes `make check`
can still fail Unit on the runner — and Unit gates E2E, so the E2E run you
wanted never starts. These guards read every tracked file, which is why CI
runs Unit on every change, docs included
([ci.md](ci.md#skipping-a-suite-the-change-cannot-affect)). Run `make ci`
before pushing anything that touches `scripts/`, the Maestro flows or `ci.yml`.

## Coverage

`make test-coverage` enforces **100% of lines, branches, functions and statements**,
globally. There are no per-zone thresholds: with the global bar at 100% they
would all be redundant.

100% is a floor on *reachability*, not a claim that every behaviour is
asserted — but it makes "this file has no test" a build failure instead of a
number nobody reads, and it removes the arithmetic where a large untested file
is offset by a small thoroughly tested one.

`collectCoverageFrom` instruments `src/**/*.{ts,tsx}`, `modules/*/index.ts` and
`plugins/*.ts`. Two mechanisms narrow that:

- Test files themselves are dropped in `collectCoverageFrom`.
- `coveragePathIgnorePatterns` lists everything with no behaviour to assert.
  Each entry carries a one-line reason in `jest.config.ts`, and an entry
  without one is not mergeable. The preset holds the generic ones (ambient
  `.d.ts` declarations, other checkouts); this app adds the Jest setup files
  under `src/test/`, generated GraphQL, compiled Lingui catalogs, the three
  pure re-export route barrels under `src/app/`, and the `requireNativeModule`
  binding under `modules/*/src/`.

  The preset puts it into both Jest projects rather than once at the root:
  unlike the other coverage options this one is project-scoped, and a
  root-level copy is silently ignored when `projects` is set.

An exclusion is a claim that the file cannot be meaningfully tested, and "it is
test infrastructure" is not that claim. `src/test/render.tsx` is an ordinary
module with ordinary logic, so it is measured like any other file. Only the two
setup files are excluded, and for
a mechanical reason: every suite runs them, but they run *before* the project's
instrumentation is installed, so they report 0% however thoroughly they are
exercised.

A native module's TypeScript wrapper does **not** qualify either, just because
the native half is Swift or Kotlin — `modules/hello-native/index.ts` validates
input and maps the missing-module failure, and it is tested. If a branch really
is unreachable, prefer restructuring the code to delete it over excluding the
file: that is why the root layout's global error handler moved to
`src/lib/global-error-handler.ts`, where the "no hook on web" case is a value a
test passes rather than a branch no test can take.

### Setup scripts, the doctor and the release verifiers

`make setup` and its parts, `make doctor` and `make verify-ios` /
`make verify-android` run the shared tooling's scripts and programs, so their
tests are in shared-workflows: a bats file per script, against fakes on
`PATH`, and node:test at 100% for the doctor. What stays here is the fastlane
side: `make check-release` parses the Fastfile and lists the lanes. The lanes
themselves, including that the verify lanes call the package's verifiers with the
right arguments, are tested in shared-workflows.

### Script coverage

`pnpm test:scripts` (`make test-scripts`, `make ci`, CI's Unit job through
shared-workflows' `check-unit`) measures the Node scripts with `node:test`'s
own coverage and fails below **100% of lines, branches and functions**. The
thresholds are the shared runner's, so CI enforces exactly what
`make test-scripts` does. No dependency does the measuring, and nothing is
excluded.

Two things make that reachable:

- **Each script's command-line entry is a function.** A script exports
  `main(argv, io)` that returns the exit code, with its console, environment,
  file reads and child processes arriving through `io` (real ones by
  default). Tests call it in-process with stubs, so every exit path is a plain
  assertion, never a network call or a real `npx`. The entry is then only a
  guard, `if (import.meta.main) process.exitCode = main();` (awaited for an
  asynchronous `main`; `init.mjs` uses `.then` so a closed prompt still exits
  0), and a single subprocess run per script covers it. The coverage run hands `NODE_V8_COVERAGE` to the
  child through the environment, so a subprocess test must pass
  `{ ...process.env, ... }`, never a fresh environment.
- **Every module is in the report.** Node only reports files something loaded,
  so a script no test imports would be missing rather than at 0%. The runner
  reads the coverage report against the modules on disk and names each module
  missing from it, so a new, untested script fails the gate with its name.

The same rules as Jest apply: a threshold is never lowered, and a branch no
test can take is restructured away rather than ignored.

### Files with nothing to cover

A re-export barrel or a type-only module has zero statements. istanbul prints
it as 0% in every column while the totals stay at 100%, so it is a silent way
to add an untested file without moving the number.

`test:coverage` runs `check-coverage-empty` (from `@blinkbitcoin/app-tooling`)
after Jest, so `make test-coverage` and CI's Unit job both make the check. It
reads `coverage/coverage-summary.json` — which is why `json-summary` is in
`coverageReporters` — and fails naming any file with `statements.total === 0`.
The fix is always the same: ignore the file with a reason, or give it code
worth testing.

## The shared app suites

Some tests are about this app's own files but test shared-workflows' code: the
OTA fingerprint is the first. They live in `@blinkbitcoin/app-tooling` and run
against this checkout through `make test-app` (`pnpm test:app`, `make ci`, and
CI's `Checks / App suites` job, switched on by `app-suites: true` in
`ci.yml`). `pnpm exec test-app --list` prints which suites run and why any
other is skipped. They move with the shared-workflows pin, so the Dependabot PR
that changes a suite runs it here before it merges.

| Suite | What it proves here |
| --- | --- |
| `fingerprint` | `fingerprint.config.js` loads and is `createFingerprintConfig()`'s, and a release's `APP_VERSION` /<br>`APP_BUILD_NUMBER` move neither the iOS nor the Android fingerprint, so a published update stays<br>compatible with the build it targets |

To turn a suite off, give the reason in `app-tooling.json`
(`"appSuites": { "skip": { "<suite>": "<reason>" } }`); it is printed on every
run.

## Tests are silent

A `console.error` or `console.warn` during a test fails that test. The shared
Jest preset installs the guard in both projects, after this app's own setup
files, from `@blinkbitcoin/app-tooling/expo/jest/console`; it imports nothing,
so the plain-node project can load it without RNTL or MSW.

`console.log` is deliberately *not* guarded. Metro, jest-expo and the Expo
modules log progress through it in ways the app suite does not control.

The rule earns its keep because the app logs through `src/lib/logger`, so the
console is left for the framework — and React Native reports un-acted state
updates, invalid props and failed prop types through `console.error`. **A
console line in a test is almost always a missing `await waitFor`, not a
logging need.** Fix the test before reaching for an opt-out.

Two opt-outs, both explicit and both scoped to one test:

```ts
import { allowConsole } from '@blinkbitcoin/app-tooling/expo/jest/console';

test('the error link logs the GraphQL error', async () => {
  allowConsole('warn', 'GraphQL error in X'); // string, RegExp, or omitted
  // …
});
```

`allowConsole(method, matcher?)` permits matching output on that method only;
anything unmatched still fails. Without a matcher every line on that method is
allowed for the test, which is the blunt form — prefer a matcher, so the
allowance doubles as an assertion on what was logged.

The second opt-out is a spy: a test that asserts on the logging takes the
method over and the recorder never sees the call.

```ts
const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
```

That is how `src/lib/logger.test.ts` — the suite whose whole job is to check
what reaches the console — keeps passing.

The guard's own tests live with it in shared-workflows
(`packages/app-tooling/console.test.mjs`): they unit-test the recorder and
cover both opt-outs against the live guard.

## Writing a component test

Render through the shared harness so the tree under test is the tree that
ships:

```tsx
import { renderWithProviders, screen } from '@/test/render';

await renderWithProviders(<SettingsScreen />);
expect(screen.getByTestId('settings-title')).toBeOnTheScreen();
```

`src/test/render.tsx` re-exports everything from RNTL, wraps the component in
`Providers` with the error boundary turned off, and is the only place that
needs to change when a provider is added.

Notes on RNTL 14 and React 19:

- The matchers register as a side effect of importing
  `@testing-library/react-native` itself. The old `/extend-expect` subpath is
  gone. `src/test/setup.ts` does the import once.
- Render calls are awaited in these suites so pending effects flush before the
  first assertion.
- An interaction whose result lands through a subscription outside React state
  (the theme context, Lingui's external store) needs its own awaited `act`.
  `src/features/settings/SettingsScreen.test.tsx` wraps that in a local
  `press()` helper:

  ```tsx
  async function press(testID: string) {
    await act(async () => {
      fireEvent.press(screen.getByTestId(testID));
    });
  }
  ```

- Router tests use `renderRouter(routes, { initialUrl, wrapper: Providers })`.
  The returned object is both awaitable and where `getPathname()` lives, so
  keep the handle rather than reaching for `screen`.

## Testing against the mock API

MSW is started in `src/test/setup.ts` with
`onUnhandledRequest: 'error'`, so an unexpected request fails the test rather
than hanging. The handlers execute the same executable schema the
`pnpm dev:api` server does (`mocks/README.md`), so a test cannot pass against
a response the real server would never produce.

Override one operation for a single test with `server.use(...)`:

```tsx
server.use(
  http.post('http://localhost/graphql', () =>
    HttpResponse.json({ errors: [{ message: 'boom' }] }),
  ),
);
```

`afterEach` resets the handlers. The URL has no port on purpose: no server is
listening, `src/test/env.ts` sets `EXPO_PUBLIC_API_URL` to the same value, and
`scripts/port-pins.test.mjs` runs `check-ports`, which rejects a bare port literal (see
[local-dev.md](local-dev.md)).

## Native module and plugin tests

The native module wrapper is tested against its manual mock
(`jest.mock('./src/HelloNativeModule')` in `modules/hello-native/index.test.ts`), which covers the happy path, and
against a factory that throws, which covers the "native module absent" path.
Both matter: the wrapper's contract is that a missing module produces a
`HelloNativeError` naming `make dev-ios` / `make dev-android`, synchronously from
`hello()` and as a rejection from `getBuildStamp()`.

Config plugin tests call the plugin, pull the registered mod off
`config.mods`, and invoke it with a stub `modResults`. They assert the output
and that running the mod twice is idempotent. See
`plugins/with-build-stamp.test.ts` for the pattern and
[native-extensions.md](native-extensions.md) for the surrounding workflow.

## Maestro

Local runs assume the app is already installed and Metro is running:

```sh
make dev-api       # terminal 1
make dev           # terminal 2
make dev-ios       # terminal 3, then
make test-e2e-ios  # or make test-e2e-android
```

Both run `scripts/e2e/maestro.sh`, which derives the ports from
`APP_PORT_BASE`, waits for the mock API, and hands the rest to the scripts CI
runs, from `node_modules/@blinkbitcoin/app-tooling/e2e/`: on iOS
`ios-simulator.sh pick` (the booted iPhone), `app-launch.sh ios` and
`ios-maestro.sh`; on Android `android-maestro.sh`, which reinstalls the debug
APK `make dev-android` built, sets up `adb reverse` for the Metro and mock-API
ports, turns the emulator's animations off as CI does, and launches. The launch
is the `expo-development-client` deep link (see [local-dev.md](local-dev.md)),
and the suite is `maestro test .maestro` with the same retry and the same check
that flows ran as in CI. The junit report and Maestro's debug output land in
`.maestro/output/maestro/` (`WORKFLOWS_OUT` moves it). Extra arguments reach
`maestro test`: `pnpm test:e2e:ios --include-tags smoke`. The app id and scheme
come from the Expo config, which needs `yq` (pinned in `.mise.toml`).

### Adding a flow

1. Create `.maestro/flows/<name>.yaml`. Start it with `appId: ${APP_ID}` and
   `tags: [smoke]`. `.maestro/config.yaml` has `includeTags: [smoke]`, so an
   untagged flow never runs.
2. **Register the name in `executionOrder.flowsOrder`** in
   `.maestro/config.yaml`. Maestro 2.x does not order a glob alphabetically,
   and every flow after `00-launch` assumes the app is already foregrounded on
   Home. An unregistered flow runs in an arbitrary position, or not at all.
3. Drive the UI by `testID`, never by copy: the app is localized, and an
   assertion on English text breaks the moment the locale changes. The existing
   ids follow `screen-element`, for example `tab-home`, `tab-settings`
   (both set with `tabBarButtonTestID`), `tab-home-icon`, `tab-settings-icon`
   (the tab bar icons, hidden from accessibility), `home-title`,
   `home-open-details`, `details-id`, `settings-theme-dark`,
   `settings-trigger-error`, `native-hello`, `native-build-stamp`,
   `error-retry`.
4. Give anything that crosses the network room to arrive. `home.yaml` uses
   `extendedWaitUntil` with a 20 second timeout for the greeting that comes
   from the mock API.
5. Do not add `clearState` or restart the app. That throws away the
   deep-linked session and drops the dev client back on its launcher.
6. Start from the tab bar. The suite runs with `stopApp: false`, so a flow
   inherits whatever the previous one left on screen, and a pushed screen
   (Details) covers the tab bar. `runFlow: ../helpers/to-tab-bar.yaml` first,
   as every tab flow does, or one failure turns into a failure in every flow
   after it.
7. Never open the session's first URL. iOS puts up "Open in <app>?" for the
   first `simctl openurl` of a simulator session and, on a loaded runner, acted
   on that first link ~40 s late — during the *next* flow. `00-launch` opens
   the scheme's bare root link once so every later `openLink` is alert-free and
   immediate. A flow that opens a URL still waits with `extendedWaitUntil`; see
   [ADR 0010](https://github.com/blinkbitcoin/shared-workflows/blob/main/docs/decisions/app-0010-ios-e2e-release-build.md).

### iOS is a Release build in CI

`ci.yml` passes `ios-configuration: Release`: the bundle is embedded, no Metro,
no dev launcher, no prompt at launch. Two things follow. `EXPO_PUBLIC_*`
values reach that app only through the `environment-variables` input — a Release bundle
resolves `.env.production`, not `.env.development`, and an exported variable
beats the dotenv file — so `ci.yml` passes the mock API URL explicitly.
And the iOS suite no longer covers the Metro dev path; Android still does.

## Playwright

`make test-e2e-web` runs `scripts/e2e/web.sh`, which exports the site with
`pnpm build:web` (a production export, the flavour that deploys) and then runs
the suite in `e2e/web/`.
`playwright.config.ts` starts two web servers for it: the mock API and
the shared tooling's `serve-dist`, both on ports derived from `APP_PORT_BASE`. The
latter serves `dist` the way GitHub Pages does - under `EXPO_PUBLIC_BASE_URL`
when a deploy export was built for a sub-path, `/settings` from
`settings.html`, and `404.html` with a 404 for a path with no file, which is
how a deep link into `/details/42` boots the router (`e2e/web/deep-link.spec.ts`).

Setting `PLAYWRIGHT_SKIP_EXPORT` skips the export and tests whatever is
already in `dist/`. CI sets it so Playwright exercises the exact artifact the
deploy job would publish, instead of a second, possibly different export.
That artifact is a **production** export when it is going to deploy, and a
production export bakes `.env.production`'s API URL - a host no test can
reach. `e2e/web/fixtures.ts` therefore routes every `**/graphql` request the
page makes to the mock API and replays the response, whatever host the bundle
was built for. Specs import `test` from `./fixtures`, not from
`@playwright/test`. Rebuilding the export against the mock would have meant
testing different bytes from the ones that deploy.

## Reading a failed run

CI uploads named artifacts. Download these from the run summary first:

| Artifact | From | Contents |
| --- | --- | --- |
| `forensics-ios` | the `ios` E2E job | Maestro debug tree, simulator recording, Metro log, device log, fresh crash reports |
| `forensics-android` | the `android` E2E job | Maestro debug tree, emulator recording, Metro log, logcat |
| `playwright-report` | the web job | The Playwright HTML report with traces and screenshots |
| `coverage` | the unit job | `coverage/`, uploaded on every run |

`forensics-ios` also carries `ios-unified.log`, the simulator's unified log
filtered to SpringBoard's alert lifecycle, FrontBoard's scene actions and any
line naming the app id or scheme. For a deep link that "did nothing", that is
the file: `Presenting <SBUserNotificationAlert` is the prompt, `url = <scheme>://…`
is the `UIOpenURLAction` reaching the app, and the gap to the next
navigation-bar layout is where the time went.

A green run is not the same as a green first attempt. The suite is retried
once on a real failure and the artifact carries the retry; grep the job log
for `rerunning the suite once`. A first attempt that failed is a flake to
fix, and the flakes in this suite have all been one event reported by the
flow it landed on, not the flow that caused it.

Locally the same Maestro debug tree lands in `.maestro/output/maestro/`,
which is gitignored. Full detail in [ci.md](ci.md).

## Rehearsing a release lane

The store lanes can be walked end to end on a laptop with no credentials:
`DRY_RUN=1` makes every store call log its arguments and return canned data.
The exact environment a rehearsal needs is in
[release-runbook.md](release-runbook.md), under "Rehearsing lanes locally".
`make check-release` runs the lane unit tests, which is the cheap check to run
before touching `fastlane/`.
