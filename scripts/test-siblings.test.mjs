// Every source file has a test file of its own, and that file alone covers it
// at 100%: `foo.mjs` has `foo.test.mjs`, `Foo.tsx` has `Foo.test.tsx`. Global
// coverage can be 100% while a module is only reached through a caller's test,
// and then nothing fails when that caller stops calling it. This check holds
// the half a tool can see - the sibling exists - and names every file without
// one; each file's own coverage is checked by running its test alone (see
// docs/testing.md).
//
// The one place a sibling cannot sit next to its module is `src/app/`:
// expo-router reads every `.ts(x)` file there as a route, so a test beside a
// route would be bundled and registered as one. Expo's own guidance is to keep
// tests out of the app directory, so a route's test mirrors its path under
// `src/__tests__/app/` instead.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * Files that may have no sibling test, each with the reason. The bar is the
 * one `coveragePathIgnorePatterns` sets: a file with nothing a test could
 * assert. An entry whose file gains a test, or disappears, fails below.
 */
const ALLOWLIST = new Map([]);

const ROUTES = 'src/app/';
const ROUTE_TESTS = 'src/__tests__/app/';

/** Source files the rule covers; everything else is out of scope. */
function isSource(file) {
  if (/\.test\.[^/]+$/.test(file)) return false;
  if (file.startsWith('scripts/')) return file.endsWith('.mjs');
  if (file.startsWith('src/')) {
    if (!/\.tsx?$/.test(file) || file.endsWith('.d.ts')) return false;
    return !/^src\/(graphql\/generated|i18n\/locales|test|__tests__)\//.test(file);
  }
  return /^plugins\/[^/]+\.ts$/.test(file) || /^modules\/[^/]+\/index\.ts$/.test(file);
}

/**
 * The paths a file's sibling test may take. TypeScript may use either
 * extension, since a `.ts` module is often tested by rendering it in JSX.
 */
function siblingsOf(file) {
  const tested = file.startsWith(ROUTES) ? ROUTE_TESTS + file.slice(ROUTES.length) : file;
  const { dir, name, ext } = path.posix.parse(tested);
  const exts = ext === '.mjs' ? ['.mjs'] : ['.ts', '.tsx'];
  return exts.map((e) => path.posix.join(dir, `${name}.test${e}`));
}

/** Every source file in `files` without a sibling test, less the allowlist. */
function missingSiblings(files, allowlist) {
  const present = new Set(files);
  return files
    .filter(isSource)
    .filter((file) => !allowlist.has(file))
    .filter((file) => !siblingsOf(file).some((sibling) => present.has(sibling)));
}

/** What is wrong with each allowlist entry; empty when nothing is. */
function allowlistProblems(allowlist, files) {
  const missing = new Set(missingSiblings(files, new Map()));
  return [...allowlist]
    .map(([file, reason]) => {
      if (!reason.trim()) return `${file}: give it a one-line reason`;
      return missing.has(file) ? null : `${file}: has a test or is gone, so remove the entry`;
    })
    .filter(Boolean);
}

/** Test files under src/app/, which expo-router would load as routes. */
const testsInRoutes = (files) =>
  files.filter((file) => file.startsWith(ROUTES) && /\.test\.[^/]+$/.test(file));

/** Route tests whose route does not exist: renamed or deleted without them. */
function orphanRouteTests(files) {
  const present = new Set(files);
  return files
    .filter((file) => file.startsWith(ROUTE_TESTS))
    .filter((file) => {
      const route = ROUTES + file.slice(ROUTE_TESTS.length).replace(/\.test\.tsx?$/, '');
      return !['.tsx', '.ts'].some((ext) => present.has(route + ext));
    });
}

const tracked = execFileSync(
  'git',
  ['ls-files', '-z', '--', 'scripts', 'src', 'plugins', 'modules'],
  {
    cwd: root,
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(Boolean);

test('every source file has its own sibling test', () => {
  const missing = missingSiblings(tracked, ALLOWLIST);
  assert.deepEqual(
    missing,
    [],
    `add a test next to each (a route's goes under ${ROUTE_TESTS}):\n  ${missing.join('\n  ')}`,
  );
});

describe('the rule', () => {
  test('names a file without a sibling, and not one with', () => {
    const files = [
      'scripts/a.mjs',
      'scripts/a.test.mjs',
      'scripts/lib/b.mjs',
      'src/c.ts',
      'src/c.test.tsx',
      'src/D.tsx',
      'src/E.tsx',
      'src/E.test.tsx',
      'src/F.web.tsx',
      'plugins/with-g.ts',
      'plugins/with-g.test.ts',
      'modules/h/index.ts',
    ];
    assert.deepEqual(missingSiblings(files, new Map()), [
      'scripts/lib/b.mjs',
      'src/D.tsx',
      'src/F.web.tsx',
      'modules/h/index.ts',
    ]);
  });

  test('a test in a caller, or in a __tests__ directory, is not a sibling', () => {
    const files = [
      'src/lib/a.ts',
      'src/lib/lib.test.ts',
      'modules/h/index.ts',
      'modules/h/__tests__/index.test.ts',
    ];
    assert.deepEqual(missingSiblings(files, new Map()), ['src/lib/a.ts', 'modules/h/index.ts']);
  });

  test("a script's test must be a script", () => {
    assert.deepEqual(missingSiblings(['scripts/a.mjs', 'scripts/a.test.ts'], new Map()), [
      'scripts/a.mjs',
    ]);
  });

  test('a route is tested from its mirror under src/__tests__/app/', () => {
    const files = [
      'src/app/_layout.tsx',
      'src/__tests__/app/_layout.test.tsx',
      'src/app/details/[id].tsx',
      'src/app/details/[id].test.tsx',
    ];
    assert.deepEqual(missingSiblings(files, new Map()), ['src/app/details/[id].tsx']);
  });

  test('leaves out generated code, test support and files that are not modules', () => {
    const files = [
      'src/graphql/generated/graphql.ts',
      'src/i18n/locales/en/messages.ts',
      'src/test/setup.ts',
      'src/global.d.ts',
      'src/features/home/hello.graphql',
      'scripts/check-docs.sh',
      'plugins/helpers/x.ts',
      'modules/h/src/HelloNativeModule.ts',
    ];
    assert.deepEqual(missingSiblings(files, new Map()), []);
  });

  test('an allowlisted file needs no sibling', () => {
    assert.deepEqual(missingSiblings(['src/a.ts'], new Map([['src/a.ts', 'why']])), []);
  });
});

describe('the allowlist', () => {
  test('every entry has a reason and still names a file without a test', () => {
    assert.deepEqual(allowlistProblems(ALLOWLIST, tracked), []);
  });

  test('flags an entry without a reason, and one whose file has a test or is gone', () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/c.test.ts'];
    const allowlist = new Map([
      ['src/a.ts', 'nothing to assert'],
      ['src/b.ts', ' '],
      ['src/c.ts', 'nothing to assert'],
      ['src/gone.ts', 'nothing to assert'],
    ]);
    assert.deepEqual(allowlistProblems(allowlist, files), [
      'src/b.ts: give it a one-line reason',
      'src/c.ts: has a test or is gone, so remove the entry',
      'src/gone.ts: has a test or is gone, so remove the entry',
    ]);
  });
});

describe('route tests', () => {
  test('none sits under src/app/, where expo-router would load it as a route', () => {
    assert.deepEqual(testsInRoutes(tracked), [], `move each under ${ROUTE_TESTS}`);
    assert.deepEqual(
      testsInRoutes(['src/app/a.tsx', 'src/app/a.test.tsx', 'src/__tests__/app/a.test.tsx']),
      ['src/app/a.test.tsx'],
    );
  });

  test('each one under src/__tests__/app/ mirrors a route that exists', () => {
    assert.deepEqual(orphanRouteTests(tracked), [], 'rename or remove each to match its route');
    const files = [
      'src/app/a.tsx',
      'src/app/b.ts',
      'src/__tests__/app/a.test.tsx',
      'src/__tests__/app/b.test.ts',
      'src/__tests__/app/renamed.test.tsx',
    ];
    assert.deepEqual(orphanRouteTests(files), ['src/__tests__/app/renamed.test.tsx']);
  });
});
