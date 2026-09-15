import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BASE_DEFAULT,
  BASE_VAR,
  SERVICES,
  baseFrom,
  envLines,
  mockApiUrl,
  portFrom,
  resolvePorts,
} from './ports.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

test('the base is 8080 and every service has its own consecutive offset', () => {
  assert.equal(BASE_DEFAULT, 8080);
  const offsets = Object.values(SERVICES).map((s) => s.offset);
  // Metro is +1 on purpose: 8081 is Expo's default and what the dev-client deep
  // link assumes, so the default base leaves every existing instruction true.
  assert.deepEqual(offsets, [1, 2, 3]);
  const names = Object.values(SERVICES).map((s) => s.env);
  assert.equal(new Set(names).size, names.length);
});

test('resolves the documented defaults', () => {
  assert.deepEqual(resolvePorts({}), {
    base: 8080,
    metro: 8081,
    mockApi: 8082,
    webPreview: 8083,
  });
  assert.equal(mockApiUrl(8082), 'http://localhost:8082/graphql');
});

test('moves every service with the base', () => {
  const ports = resolvePorts({ [BASE_VAR]: '8090' });
  assert.equal(ports.base, 8090);
  for (const [key, { offset }] of Object.entries(SERVICES)) {
    assert.equal(ports[key], 8090 + offset);
  }
});

test('lets one service override its port without moving the others', () => {
  const ports = resolvePorts({ [BASE_VAR]: '8090', MOCK_API_PORT: '4444' });
  assert.equal(ports.mockApi, 4444);
  assert.equal(ports.metro, 8091);
  assert.equal(ports.webPreview, 8093);
});

test('an empty variable is the same as an unset one', () => {
  assert.equal(baseFrom({ [BASE_VAR]: '' }), BASE_DEFAULT);
  assert.equal(resolvePorts({ METRO_PORT: '' }).metro, 8081);
});

for (const value of ['0', '65536', '-1', '1.5', 'abc', ' ']) {
  test(`portFrom rejects ${JSON.stringify(value)}`, () => {
    assert.throws(() => portFrom('METRO_PORT', value, 1), /METRO_PORT must be a port number/);
  });
}

test('portFrom accepts the edges of the range', () => {
  assert.equal(portFrom('X', '1', 9), 1);
  assert.equal(portFrom('X', '65535', 9), 65535);
});

test('envLines exports every derived value, including the baked API url', () => {
  assert.deepEqual(envLines({ [BASE_VAR]: '8090' }), [
    'export APP_PORT_BASE=8090',
    'export METRO_PORT=8091',
    'export MOCK_API_PORT=8092',
    'export WEB_PREVIEW_PORT=8093',
    'export RCT_METRO_PORT=8091',
    'export EXPO_PUBLIC_API_URL=http://localhost:8092/graphql',
  ]);
});

// A service variable inherited from the ambient environment would read as a
// deliberate override and make this assertion about the caller's shell rather
// than about the helper. Blank all three; CI runs under mise, which exports
// APP_PORT_BASE, and a developer may legitimately have one of these set.
const bareServiceEnv = Object.fromEntries(Object.values(SERVICES).map(({ env }) => [env, '']));

test('the --sh CLI prints exactly those lines for the caller environment', () => {
  const out = execFileSync(process.execPath, [path.join(root, 'scripts/ports.mjs'), '--sh'], {
    env: { ...process.env, ...bareServiceEnv, [BASE_VAR]: '8090' },
    encoding: 'utf8',
  });
  assert.deepEqual(out.trim().split('\n'), envLines({ [BASE_VAR]: '8090' }));
});

test('a per-service override still reaches the CLI', () => {
  const out = execFileSync(process.execPath, [path.join(root, 'scripts/ports.mjs'), '--sh'], {
    env: { ...process.env, ...bareServiceEnv, [BASE_VAR]: '8090', MOCK_API_PORT: '4444' },
    encoding: 'utf8',
  });
  assert.ok(out.includes('export MOCK_API_PORT=4444'), out);
  assert.ok(out.includes('export METRO_PORT=8091'), out);
});

// ---------------------------------------------------------------------------
// The mirrors. Neither file can import JavaScript, so each restates part of the
// table; these pins are what stops them drifting away from it.
// ---------------------------------------------------------------------------

test('.mise.toml exports the base and never a derived port', () => {
  const mise = read('.mise.toml');
  assert.match(
    mise,
    new RegExp(`${BASE_VAR} = "{{ env\\.${BASE_VAR} \\| default\\(value='${BASE_DEFAULT}'\\)`),
  );
  // The whole point. A mirrored METRO_PORT=8081 sits in the environment of every
  // mise-activated shell, `mise exec` and CI job, where resolvePorts cannot tell
  // it from a deliberate per-service override - so the base would silently stop
  // moving anything. One producer: scripts/ports.mjs.
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

// ---------------------------------------------------------------------------
// The consumers derive rather than freeze
// ---------------------------------------------------------------------------

for (const [file, needle] of [
  ['playwright.config.ts', 'resolvePorts'],
  ['mocks/server.ts', 'resolvePorts'],
  ['scripts/e2e/wait-for-mock-api.sh', 'node scripts/ports.mjs --sh'],
  ['scripts/e2e/maestro-ios.sh', 'node scripts/ports.mjs --sh'],
  ['scripts/e2e/maestro-android.sh', 'node scripts/ports.mjs --sh'],
  ['scripts/e2e/ci-mock-api-up.sh', 'node scripts/ports.mjs --sh'],
  ['Makefile', 'node scripts/ports.mjs --sh'],
]) {
  test(`${file} takes its ports from the helper`, () => {
    assert.ok(read(file).includes(needle), `${file} must reference ${needle}`);
  });
}

// ---------------------------------------------------------------------------
// The guard: no bare port literal anywhere else in the tracked tree
// ---------------------------------------------------------------------------

// Ports that mean something here: the base, the three derived ones, and the two
// this repo retired (4000 mock API, 8089 web preview) so a copy-paste from an
// older branch is caught too.
const PORT_LITERALS = [BASE_DEFAULT, 8081, 8082, 8083, 8089, 4000];

// A number only counts when it is used as a port. The prefixes, in order:
//
//   `:`                       a colon straight against the digits - `localhost:8081`, `tcp:8081`
//   `%3A`                     the same colon percent-encoded, in a deep link
//   `on` + slack              prose ("on 4000")
//   `-p `                     the short CLI flag
//   a port token + slack      `port 4000`, `port: 8082`, `${METRO_PORT:-8081}`,
//                             `MOCK_API_PORT ?? 4000`, `PORT=8082`, `metroPort = 8081`
//
// "slack" is up to six non-digit characters, which is what reaches across
// `:-`, ` ?? `, `=`, `: ` and ` = `. The last branch is why a straight revert
// of mocks/server.ts or maestro-ios.sh is caught. Its three spellings are
// deliberate: `\bport` for prose and lowercase keys, `Port` (capital P) for
// camelCase like `metroPort` - which `\bport` cannot see, since there is no
// word boundary inside a camelCase word - and `PORT` for env-var case. A bare
// case-insensitive `port` would also match the tail of "support".
//
// What is deliberately NOT a branch: a colon followed by a space. `webPreview:
// 8083` would be nice to catch, but `{ testflight: 4000, play: 500 }` in
// scripts/release/notes.mjs and `limit: 4000` in fastlane/ are the App Store
// note character limit, not ports, and they are the same shape. Keying on a
// `port` token instead keeps every real consumer covered (a key holding a port
// is called `port`) without allowlisting two release files that have nothing to
// do with ports - which would have been the larger hole.
const PORT_RE = new RegExp(
  `(?::|%3[Aa]|\\bon\\b[^0-9\\n]{0,6}|-p |(?:\\bport|Port|PORT)\\b[^0-9\\n]{0,6})(?:${PORT_LITERALS.join('|')})(?![0-9])`,
);

// Files allowed to carry one, each for a reason that is not "we forgot".
const ALLOWED = [
  ['scripts/ports.mjs', 'the table itself'],
  ['scripts/ports.test.mjs', 'this guard'],
  ['.mise.toml', 'the base default, pinned above'],
  ['.env.development', 'the dotenv default, pinned above'],
  ['.env.example', 'the dotenv default, pinned above'],
  ['docs/local-dev.md', 'the Ports table - the one place a reader sees the numbers, pinned above'],
  [
    'scripts/release/lib/verify-common.sh',
    "React Native's own built-in dev-server host:port constants, which a release bundle is scanned for - not a port this repo listens on",
  ],
  ['scripts/release/verify.test.mjs', 'fixtures for that scan'],
  ['docs/release-runbook.md', 'explains that same built-in React Native constant'],
  ['docs/decisions/', 'ADRs record what was true when they were accepted'],
  ['docs/superpowers/', 'archived plans and specs, not live documentation'],
  ['CHANGELOG.md', 'generated release history'],
];

const allowed = (file) => ALLOWED.some(([prefix]) => file === prefix || file.startsWith(prefix));

// Every shape this repo has actually used for a port, including the two a plain
// revert of mocks/server.ts and maestro-ios.sh would reintroduce. A guard that
// misses those is decoration.
for (const line of [
  // A template literal with an escaped `$` so Biome does not read the shell
  // parameter expansion as a botched JS one; the string is byte-identical.
  `METRO_PORT="\${METRO_PORT:-8081}"`,
  'const port = Number(process.env.MOCK_API_PORT ?? 4000);',
  'MOCK_API_PORT=8082',
  'pnpm exec expo serve dist -p 8083',
  '  const port = 8083;',
  '  webServer: { port: 8083 },',
  'const metroPort = 8081;',
  "  use: { baseURL: 'http://localhost:8089' },",
  'adb reverse tcp:8081 tcp:8081',
  'url=http%3A%2F%2Flocalhost%3A8081',
  '| `make mock-api` | Local GraphQL mock API on :4000 |',
  '`mocks/server.ts` starts on port 4000.',
  'the mock API on 4000 and',
]) {
  test(`the guard catches ${JSON.stringify(line)}`, () => {
    assert.ok(PORT_RE.test(line), `PORT_RE missed ${line}`);
  });
}

// ...without sweeping in the numbers that merely look like ports. The store
// note limits are the reason the guard keys on a prefix at all.
for (const line of [
  'TESTFLIGHT_NOTES_LIMIT = 4000',
  'export const STORE_LIMITS = { testflight: 4000, play: 500, appstore: 4000 };',
  '| App Store | release notes ("What\'s New") | 4000 characters |',
  '        write_release_notes!(dir, kind: :appstore, limit: 4000)',
  'truncated at word boundaries (4000 TestFlight, 500 Play), optionally',
  'const APP_BUILD_NUMBER = 8081234;',
]) {
  test(`the guard ignores ${JSON.stringify(line)}`, () => {
    assert.ok(!PORT_RE.test(line), `PORT_RE should not match ${line}`);
  });
}

// A tracked asset (PNG, ttf, keystore) read as UTF-8 yields replacement
// characters, and a byte run that happens to decode to ":8081" would fail the
// suite with an unreadable message. A NUL in the first chunk is the cheap,
// extension-agnostic "this is not text" test that git itself uses.
const isBinary = (absolute) => {
  const fd = openSync(absolute, 'r');
  try {
    const buffer = Buffer.alloc(8000);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read).includes(0);
  } finally {
    closeSync(fd);
  }
};

test('no file hardcodes a port that APP_PORT_BASE is supposed to move', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((file) => !allowed(file));

  const offenders = [];
  for (const file of tracked) {
    const absolute = path.join(root, file);
    let content;
    try {
      if (isBinary(absolute)) continue;
      content = readFileSync(absolute, 'utf8');
    } catch {
      continue; // gone, or unreadable; nothing to match
    }
    content.split('\n').forEach((line, i) => {
      if (PORT_RE.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `hardcoded port(s) found. Derive them from ${BASE_VAR} via scripts/ports.mjs, or add the file to ALLOWED in scripts/ports.test.mjs with a reason:\n${offenders.join('\n')}`,
  );
});
