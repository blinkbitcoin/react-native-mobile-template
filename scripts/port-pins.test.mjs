import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { main as checkPorts } from '@blinkbitcoin/app-tooling/check-ports';
import {
  BASE_DEFAULT,
  BASE_VAR,
  mockApiUrl,
  resolvePorts,
  SERVICES,
} from '@blinkbitcoin/app-tooling/ports';

// The port table, its resolver, the `ports` program and the guard against a
// bare port literal are @blinkbitcoin/app-tooling's, tested there. What stays
// here is what only this repository can pin: the files that mirror the table,
// and that nothing hardcodes a port the base is meant to move.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

test('no tracked file hardcodes a port that APP_PORT_BASE is supposed to move', () => {
  const lines = { log: [], error: [] };
  const code = checkPorts(['--root', root], {
    log: (line) => lines.log.push(line),
    error: (line) => lines.error.push(line),
  });
  assert.equal(code, 0, lines.error.join('\n'));
});

test('.mise.toml exports the base and never a derived port', () => {
  const mise = read('.mise.toml');
  assert.match(
    mise,
    new RegExp(`${BASE_VAR} = "{{ env\\.${BASE_VAR} \\| default\\(value='${BASE_DEFAULT}'\\)`),
  );
  // The whole point. A mirrored METRO_PORT=8081 sits in the environment of every
  // mise-activated shell, `mise exec` and CI job, where resolvePorts cannot tell
  // it from a deliberate per-service override - so the base would silently stop
  // moving anything. One producer: the package's `ports`.
  for (const { env: name } of Object.values(SERVICES)) {
    assert.doesNotMatch(
      mise,
      new RegExp(`^\\s*${name}\\s*=`, 'm'),
      `.mise.toml must not export ${name}: it is derived, and mise would shadow the base`,
    );
  }
  // Expo bakes EXPO_PUBLIC_API_URL into the bundle, so it must stay a dotenv
  // default rather than something mise exports over the top of every command.
  assert.doesNotMatch(mise, /^\s*EXPO_PUBLIC_API_URL\s*=/m);
});

// docs/local-dev.md's Ports table is the third mirror: the one place a reader
// sees the actual numbers. It is on the guard's ALLOWED list for exactly that
// reason, so pin it here instead - strictly stronger than the grep, which only
// ever asked "is there a literal", not "is it the right literal".
test("docs/local-dev.md's port table matches the table", () => {
  const doc = read('docs/local-dev.md');
  const ports = resolvePorts({});
  assert.match(doc, new RegExp(`\\| \`${BASE_VAR}\` \\| \`${BASE_DEFAULT}\` \\|`));
  for (const [key, { offset, env: name }] of Object.entries(SERVICES)) {
    assert.match(
      doc,
      new RegExp(`\\| \`${name}\` \\| \`${ports[key]}\` \\| \\+${offset} \\|`),
      `docs/local-dev.md must document ${name} as ${ports[key]} (base+${offset})`,
    );
  }
});

for (const file of ['.env.development', '.env.example']) {
  test(`${file} points EXPO_PUBLIC_API_URL at the default mock API port`, () => {
    assert.match(
      read(file),
      new RegExp(`^EXPO_PUBLIC_API_URL=${mockApiUrl(resolvePorts({}).mockApi)}$`, 'm'),
    );
  });
}

// The one place the URL has to be a literal. The iOS E2E app is a Release
// build, so it embeds EXPO_PUBLIC_API_URL when the bundle is written - in a
// job that runs before, and on a different runner from, the one that starts
// the mock API. Nothing sets APP_PORT_BASE on a runner, so the default is what
// the mock API will listen on; this test is what keeps the two in step if the
// default ever moves.
test('ci.yml builds the iOS E2E app against the default mock API port', () => {
  const ci = read('.github/workflows/ci.yml');
  const url = mockApiUrl(resolvePorts({}).mockApi);
  assert.match(
    ci,
    new RegExp(`^\\s*environment-variables: '\\{"EXPO_PUBLIC_API_URL":"${url}"\\}'$`, 'm'),
    `ci.yml must pass environment-variables with EXPO_PUBLIC_API_URL=${url}`,
  );
});

// ---------------------------------------------------------------------------
// The consumers derive rather than freeze
// ---------------------------------------------------------------------------

for (const [file, needle] of [
  // playwright.config.ts is not here on purpose: Playwright require()s a .ts
  // config and this package is CommonJS, so importing an ES module throws.
  // web.sh derives the ports and exports them; the config reads those. The
  // literal guard below is what stops it hardcoding one instead.
  ['scripts/e2e/web.sh', 'pnpm exec ports --sh'],
  ['mocks/server.ts', 'resolvePorts'],
  ['scripts/e2e/maestro.sh', 'pnpm exec ports --sh'],
  ['Makefile', 'pnpm exec ports --sh'],
  // check:unused: knip loads playwright.config.ts, which needs the ports.
  ['package.json', 'pnpm exec ports --sh'],
]) {
  test(`${file} takes its ports from the helper`, () => {
    assert.ok(read(file).includes(needle), `${file} must reference ${needle}`);
  });
}
