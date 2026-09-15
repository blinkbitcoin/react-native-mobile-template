# Testing

Five runners, each with a job. Nothing here needs a network.

## The layers

| Layer | Runner | Lives in | Run with |
| --- | --- | --- | --- |
| Unit (pure TS) | Jest, `app` project (jest-expo) | `src/**/*.test.ts` | `make unit` |
| Component | Jest, RNTL 14 | `src/**/*.test.tsx` | `make unit` |
| Router | Jest, `renderRouter` from `expo-router/testing-library` | `src/features/**` | `make unit` |
| Apollo with a real schema | Jest, MSW over the `mocks/` executable schema | anything that renders a query | `make unit` |
| Native module wrapper | Jest, the manual mock in `modules/hello-native/src/__mocks__/` | `modules/hello-native/__tests__/` | `make unit` |
| Config plugins | Jest, `plugins` project (plain node) | `plugins/*.test.ts` | `make unit` |
| Node scripts | `node:test` | `scripts/**/*.test.mjs` | `make test-scripts` |
| Fastlane lanes | minitest | `fastlane/test/lanes_test.rb` | `make check-release` |
| E2E, native | Maestro | `.maestro/flows/` | `make e2e-ios`, `make e2e-android` |
| E2E, web | Playwright | `e2e/web/` | `make e2e-web` |

`make test` is `make unit` plus `make check-code`. `make coverage` is what CI
enforces.

### The two Jest projects

`jest.config.ts` defines them:

- `app`: the `jest-expo` preset, `src/test/env.ts` and `src/test/setup.ts`, the
  `@/*` path alias, and module mocks for `expo-secure-store`,
  `expo-sqlite/kv-store` and `expo-updates`. It ignores `/plugins/`, `/e2e/`
  and `/scripts/`.
- `plugins`: plain node, matching `plugins/**/*.test.ts`. Config plugins run
  inside the Expo CLI, not in a React Native runtime, so they get no preset.
  Its only setup file is `src/test/setup.plugins.ts`, which installs the
  console guard below and nothing else.

Coverage options are global, which is why they sit at the top level and not in
either project.

### `pnpm test:scripts`

`node --test "scripts/**/*.test.mjs"` covers the tooling that has no business
booting React Native:

| Suite | Covers |
| --- | --- |
| `scripts/doctor.test.mjs` | The toolchain check |
| `scripts/check-licenses.test.mjs` | The SPDX allowlist logic |
| `scripts/init.test.mjs` | The template rename and web-removal script behind `make init` |
| `scripts/hooks/install-if-lockfile-changed.test.mjs` | The post-merge / post-checkout lockfile-install hook |
| `scripts/release/resolve-version.test.mjs` | Version resolution for a build |
| `scripts/release/notes.test.mjs` | Store notes from a release body or from commits |
| `scripts/release/verify.test.mjs` | The artifact verification helpers |
| `scripts/release/fingerprint.test.mjs` | The fingerprint and OTA plumbing |
| `scripts/release/build-info.test.mjs` | The per-build provenance record |

## Coverage

Thresholds live in `jest.config.ts` and are enforced by `make coverage`:

| Path | Lines | Branches |
| --- | --- | --- |
| Global | 80% | 80% |
| `src/config/**` | 100% | 100% |
| `src/lib/**` | 100% | 100% |
| `modules/*/index.ts` | 100% | 100% |
| `plugins/**` | 100% | 100% |

The 100% zones are the code that is hard to notice when it breaks: env
parsing, the storage and crash-reporting wrappers, the native module contract
and the config plugins. A new file in any of them needs a test in the same
commit.

`collectCoverageFrom` instruments `src/**/*.{ts,tsx}`, `modules/*/index.ts` and
`plugins/*.ts`, and excludes tests, type declarations, `src/test/**`, the
generated GraphQL and i18n output, and `src/app/**`. Routes are excluded
because they are thin: the screens they mount are tested directly.

## Tests are silent

A `console.error` or `console.warn` during a test fails that test. Both Jest
projects install the guard: the `app` project through `src/test/setup.ts`, the
`plugins` project through `src/test/setup.plugins.ts`. Both call
`installConsoleGuard()` from `src/test/console.ts`, which imports nothing so the
plain-node project can load it without RNTL or MSW.

`console.log` is deliberately *not* guarded. Metro, jest-expo and the Expo
modules log progress through it in ways the app suite does not control.

The rule earns its keep because the app logs through `src/lib/logger`, so the
console is left for the framework — and React Native reports un-acted state
updates, invalid props and failed prop types through `console.error`. **A
console line in a test is almost always a missing `await waitFor`, not a
logging need.** Fix the test before reaching for an opt-out.

Two opt-outs, both explicit and both scoped to one test:

```ts
import { allowConsole } from '@/test/console';

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

`src/test/console.test.ts` unit-tests the recorder directly (an `afterEach`
cannot observe its own failure) and covers both opt-outs against the live
guard.

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
`pnpm mock-api` server does (`mocks/README.md`), so a test cannot pass against
a response the real server would never produce.

Override one operation for a single test with `server.use(...)`:

```tsx
server.use(
  http.post('http://localhost:4000/graphql', () =>
    HttpResponse.json({ errors: [{ message: 'boom' }] }),
  ),
);
```

`afterEach` resets the handlers.

## Native module and plugin tests

The native module wrapper is tested against its manual mock
(`jest.mock('../src/HelloNativeModule')`), which covers the happy path, and
against a factory that throws, which covers the "native module absent" path.
Both matter: the wrapper's contract is that a missing module produces a
`HelloNativeError` naming `make ios` / `make android`, synchronously from
`hello()` and as a rejection from `getBuildStamp()`.

Config plugin tests call the plugin, pull the registered mod off
`config.mods`, and invoke it with a stub `modResults`. They assert the output
and that running the mod twice is idempotent. See
`plugins/with-build-stamp.test.ts` for the pattern and
[native-extensions.md](native-extensions.md) for the surrounding workflow.

## Maestro

Local runs assume the app is already installed and Metro is running:

```sh
make mock-api    # terminal 1
make start       # terminal 2
make ios         # terminal 3, then
make e2e-ios     # or make e2e-android
```

`scripts/e2e/maestro-ios.sh` and `scripts/e2e/maestro-android.sh` wait for the
mock API, open the `expo-development-client` deep link (see
[local-dev.md](local-dev.md)), and run `maestro test .maestro` with
`--debug-output .maestro/output --flatten-debug-output`. Android also sets up
`adb reverse` for ports 8081 and 4000.

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
   (both set with `tabBarButtonTestID`), `home-title`,
   `home-open-details`, `details-id`, `settings-theme-dark`,
   `settings-trigger-error`, `native-hello`, `native-build-stamp`,
   `error-retry`.
4. Give anything that crosses the network room to arrive. `home.yaml` uses
   `extendedWaitUntil` with a 20 second timeout for the greeting that comes
   from the mock API.
5. Do not add `clearState` or restart the app. That throws away the
   deep-linked session and drops the dev client back on its launcher.

## Playwright

`make e2e-web` runs `scripts/e2e/web.sh`, which exports the site with
`pnpm build:web --dev` and then runs the suite in `e2e/web/`.
`playwright.config.ts` starts two web servers for it: the mock API on 4000 and
`expo serve dist` on 8089.

Setting `PLAYWRIGHT_SKIP_EXPORT` skips the export and tests whatever is
already in `dist/`. CI sets it so Playwright exercises the exact artifact the
deploy job would publish, instead of a second, possibly different export.

## Reading a failed run

CI uploads named artifacts. Download these from the run summary first:

| Artifact | From | Contents |
| --- | --- | --- |
| `forensics-ios` | the `ios` E2E job | Maestro debug tree, simulator recording, Metro log, device log, fresh crash reports |
| `forensics-android` | the `android` E2E job | Maestro debug tree, emulator recording, Metro log, logcat |
| `playwright-report` | the web job | The Playwright HTML report with traces and screenshots |
| `coverage` | the unit job | `coverage/`, uploaded on every run |

Locally the same Maestro debug tree lands in `.maestro/output/`, which is
gitignored. Full detail in [ci.md](ci.md).

## Rehearsing a release lane

The store lanes can be walked end to end on a laptop with no credentials:
`DRY_RUN=1` makes every store call log its arguments and return canned data.
The exact environment a rehearsal needs is in
[release-runbook.md](release-runbook.md), under "Rehearsing lanes locally".
`make check-release` runs the lane unit tests, which is the cheap check to run
before touching `fastlane/`.
