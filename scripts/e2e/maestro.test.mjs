// scripts/e2e/maestro.sh: this app's half of a local Maestro run. The launch and
// the suite are the shared tooling's scripts, tested in shared-workflows; this
// file tests what the wrapper adds - the ports from the package's `ports`, the wait
// for the mock API, the output directory and the order of the steps. Each case
// runs the real script in a throwaway checkout whose wait script and package
// scripts are fakes that record their arguments and the environment they saw.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.join(HERE, '..', '..');
const PACKAGE_E2E = 'node_modules/@blinkbitcoin/app-tooling/e2e';

let checkouts = [];
afterEach(() => {
  for (const dir of checkouts) rmSync(dir, { recursive: true, force: true });
  checkouts = [];
});

/**
 * A fake step: appends one line (its name, its arguments, and the variables the
 * wrapper hands on) to calls.log, then exits with the status in FAIL_<NAME>.
 */
const fake = (name) => `#!/usr/bin/env bash
key="FAIL_$(printf '%s' "${name}" | tr 'a-z-' 'A-Z_')"
printf '%s|%s|%s|%s|%s\\n' "${name}" "$*" "\${WORKFLOWS_METRO_PORT:-}" "\${WORKFLOWS_MOCK_API_PORT:-}" "\${WORKFLOWS_OUT:-}" >> "$(dirname "$0")/../../../../calls.log"
exit "\${!key:-0}"
`;

/** A checkout with the real wrapper and port helper, and fakes for everything they start. */
const checkout = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'maestro-wrapper-'));
  checkouts.push(root);
  mkdirSync(path.join(root, 'scripts', 'e2e'), { recursive: true });
  mkdirSync(path.join(root, PACKAGE_E2E), { recursive: true });
  copyFileSync(
    path.join(REPOSITORY, 'scripts/e2e/maestro.sh'),
    path.join(root, 'scripts/e2e/maestro.sh'),
  );
  // `pnpm exec ports` is the package's program; the checkout has no pnpm, so a
  // shim runs the real one from this repository's own node_modules.
  const shim = path.join(root, 'bin');
  mkdirSync(shim);
  writeFileSync(
    path.join(shim, 'pnpm'),
    `#!/usr/bin/env bash\n[ "$1 $2" = "exec ports" ] || exit 64\nshift 2\nexec node "${path.join(REPOSITORY, 'node_modules/@blinkbitcoin/app-tooling/bin/ports.mjs')}" "$@"\n`,
  );
  chmodSync(path.join(shim, 'pnpm'), 0o755);
  const steps = {
    [`${PACKAGE_E2E}/wait-for-http.sh`]: 'wait-for-http',
    [`${PACKAGE_E2E}/ios-simulator.sh`]: 'ios-simulator',
    [`${PACKAGE_E2E}/app-launch.sh`]: 'app-launch',
    [`${PACKAGE_E2E}/ios-maestro.sh`]: 'ios-maestro',
    [`${PACKAGE_E2E}/android-maestro.sh`]: 'android-maestro',
  };
  for (const [file, name] of Object.entries(steps)) {
    writeFileSync(path.join(root, file), fake(name));
    chmodSync(path.join(root, file), 0o755);
  }
  return root;
};

/** Runs the wrapper in `root` with a clean port environment plus `env`. */
const run = (root, args, env = {}) => {
  const base = { ...process.env };
  for (const name of [
    'APP_PORT_BASE',
    'METRO_PORT',
    'MOCK_API_PORT',
    'WEB_PREVIEW_PORT',
    'WORKFLOWS_OUT',
  ])
    delete base[name];
  const result = spawnSync('bash', [path.join(root, 'scripts/e2e/maestro.sh'), ...args], {
    cwd: tmpdir(),
    encoding: 'utf8',
    env: {
      ...base,
      PATH: `${path.join(root, 'bin')}${path.delimiter}${base.PATH}`,
      APP_PORT_BASE: '9100',
      ...env,
    },
  });
  let calls = [];
  try {
    calls = readFileSync(path.join(root, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    // No step ran.
  }
  return { ...result, calls: calls.map((line) => line.split('|')) };
};

test('iOS waits for the mock API, picks the simulator, launches, then runs the suite with the arguments', () => {
  const root = checkout();
  const { status, stderr, calls } = run(root, ['ios', '--include-tags', 'smoke']);
  assert.equal(status, 0, stderr);
  const out = path.join(root, '.maestro/output');
  assert.deepEqual(calls, [
    ['wait-for-http', 'http://localhost:9102/', '9101', '9102', out],
    ['ios-simulator', 'pick', '9101', '9102', out],
    ['app-launch', 'ios', '9101', '9102', out],
    ['ios-maestro', '--include-tags smoke', '9101', '9102', out],
  ]);
});

test('Android waits for the mock API, then hands the rest to the Android suite runner', () => {
  const root = checkout();
  const { status, stderr, calls } = run(root, ['android']);
  assert.equal(status, 0, stderr);
  const out = path.join(root, '.maestro/output');
  assert.deepEqual(calls, [
    ['wait-for-http', 'http://localhost:9102/', '9101', '9102', out],
    ['android-maestro', '', '9101', '9102', out],
  ]);
});

test('a per-service port and an output directory already exported win', () => {
  const root = checkout();
  const { status, calls } = run(root, ['android'], {
    METRO_PORT: '9200',
    WORKFLOWS_OUT: '/elsewhere',
  });
  assert.equal(status, 0);
  assert.deepEqual(calls.at(-1), ['android-maestro', '', '9200', '9102', '/elsewhere']);
});

test("the suite runner's status is the script's", () => {
  for (const [platform, runner] of [
    ['ios', 'IOS_MAESTRO'],
    ['android', 'ANDROID_MAESTRO'],
  ]) {
    const { status } = run(checkout(), [platform], { [`FAIL_${runner}`]: '3' });
    assert.equal(status, 3, platform);
  }
});

test('a mock API that never answers stops the run before anything is launched', () => {
  const { status, calls } = run(checkout(), ['ios'], { FAIL_WAIT_FOR_HTTP: '1' });
  assert.equal(status, 1);
  assert.deepEqual(
    calls.map(([name]) => name),
    ['wait-for-http'],
  );
});

test('a failed pick or launch stops the iOS run before the suite', () => {
  for (const [failing, ran] of [
    ['FAIL_IOS_SIMULATOR', ['wait-for-http', 'ios-simulator']],
    ['FAIL_APP_LAUNCH', ['wait-for-http', 'ios-simulator', 'app-launch']],
  ]) {
    const { status, calls } = run(checkout(), ['ios'], { [failing]: '1' });
    assert.equal(status, 1, failing);
    assert.deepEqual(
      calls.map(([name]) => name),
      ran,
    );
  }
});

test('no platform, or an unknown one, is a usage error and runs nothing', () => {
  for (const args of [[], ['web']]) {
    const { status, stderr, calls } = run(checkout(), args);
    assert.equal(status, 2, args.join(' '));
    assert.match(stderr, /usage: maestro\.sh <ios\|android> \[maestro test arguments\.\.\.\]/);
    assert.deepEqual(calls, []);
  }
});

test('an invalid port base fails in the helper, before any step', () => {
  const { status, stderr, calls } = run(checkout(), ['ios'], { APP_PORT_BASE: 'x' });
  assert.notEqual(status, 0);
  assert.match(stderr, /APP_PORT_BASE must be a port number/);
  assert.deepEqual(calls, []);
});
