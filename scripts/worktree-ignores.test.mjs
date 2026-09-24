// Claude Code creates git worktrees under `.claude/worktrees/<name>/`: whole
// checkouts of this repository, each with its own node_modules. Every tool
// that walks the tree has to leave them alone, or a worktree's files are
// linted, type-checked and tested as if they were this checkout's own - Jest
// then fails with "Invalid hook call" (a second React) and ESLint with errors
// from files nobody changed. `.git/info/exclude` is per clone and not every
// tool reads it, so each configuration names the directory itself.
//
// Jest and Metro match absolute paths, and a worktree's own root is itself
// under `.claude/worktrees/`, so their patterns must be anchored to the root:
// an unanchored one would silently ignore every test, or the whole app, when
// run from a worktree. Those two are checked by behaviour, not by text.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const inWorktree = (base) => path.join(base, '.claude', 'worktrees', 'probe', 'src', 'a.test.ts');
const ownFile = (base) => path.join(base, 'src', 'a.test.ts');

// The configurations are loaded in a child process with coverage collection
// off: `make test-scripts` measures every module its own process loads, and
// these are not scripts - branches of theirs no test here is about (Metro's web
// resolver, the shape of Expo's ESLint preset) would count against the scripts'
// 100% gate. The child prints JSON; stderr carries Node's module-type warning
// for jest.config.ts and stays out of the test output.
const inChild = (code) => {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '--eval', code], {
    cwd: root,
    // Emptied, not deleted: child_process copies the parent's value back into
    // an environment that lacks the key. Empty turns collection off.
    env: { ...process.env, NODE_V8_COVERAGE: '' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(stdout);
};
const url = (rel) => JSON.stringify(pathToFileURL(path.join(root, rel)).href);

describe('Jest', () => {
  const projects = inChild(
    `const { default: config } = await import(${url('jest.config.ts')});
     console.log(JSON.stringify(config.projects));`,
  );
  const options = [
    'testPathIgnorePatterns',
    'modulePathIgnorePatterns',
    'coveragePathIgnorePatterns',
  ];
  // Jest substitutes <rootDir> and matches the result against absolute paths.
  const ignores = (patterns, rootDir, file) =>
    patterns.some((pattern) => new RegExp(pattern.replaceAll('<rootDir>', rootDir)).test(file));
  // This checkout's root, and a root that is itself a worktree of another clone.
  const roots = [root, path.join('/repo', '.claude', 'worktrees', 'feature')];

  for (const project of projects) {
    for (const option of options) {
      if (project.displayName === 'plugins' && option === 'testPathIgnorePatterns') continue;
      test(`${project.displayName}: ${option} skips other worktrees, not this checkout`, () => {
        const patterns = project[option] ?? [];
        for (const rootDir of roots) {
          assert.ok(ignores(patterns, rootDir, inWorktree(rootDir)), `${option} misses ${rootDir}`);
          assert.ok(!ignores(patterns, rootDir, ownFile(rootDir)), `${option} hides ${rootDir}`);
        }
      });
    }
  }

  test('plugins: testMatch only reaches this checkout', () => {
    const plugins = projects.find((project) => project.displayName === 'plugins');
    assert.deepEqual(plugins.testMatch, ['<rootDir>/plugins/**/*.test.ts']);
  });
});

test('Metro blocks other worktrees, not this checkout', () => {
  const blockList = inChild(
    `import { createRequire } from 'node:module';
     const { resolver } = createRequire(${url('package.json')})('./metro.config.js');
     console.log(JSON.stringify(resolver.blockList.map((pattern) => [pattern.source, pattern.flags])));`,
  ).map(([source, flags]) => new RegExp(source, flags));
  const blocked = (file) => blockList.some((pattern) => pattern.test(file));
  assert.ok(blocked(inWorktree(root)));
  // Expo's crawler also tests project-relative directories, to prune them.
  assert.ok(blocked(path.join('.claude', 'worktrees')));
  assert.ok(!blocked(ownFile(root)));
  assert.ok(!blocked(path.join(root, '.claude', 'worktrees-notes', 'a.ts')));
});

test('ESLint ignores other worktrees, not this checkout', () => {
  const files = [inWorktree(root), ownFile(root)];
  const ignored = inChild(
    `import { ESLint } from 'eslint';
     const eslint = new ESLint({ cwd: ${JSON.stringify(root)} });
     const files = ${JSON.stringify(files)};
     console.log(JSON.stringify(await Promise.all(files.map((file) => eslint.isPathIgnored(file)))));`,
  );
  assert.deepEqual(ignored, [true, false]);
});

describe('the configurations that name paths relative to the root', () => {
  test('Biome force-ignores them, so its scanner never finds their biome.json', () => {
    const biome = JSON.parse(read('biome.json'));
    assert.ok(biome.files.includes.includes('!!.claude/worktrees'));
  });

  // knip needs no entry, and an `ignore` one draws a "Remove from ignore"
  // hint on every run: its globs skip dot-directories and it reads .gitignore.
  test('knip never globs into them', () => {
    const knip = JSON.parse(read('knip.json'));
    for (const glob of [...knip.entry, ...knip.project]) assert.ok(!glob.startsWith('.'), glob);
  });

  test('tsc excludes them', () => {
    assert.ok(JSON.parse(read('tsconfig.json')).exclude.includes('.claude/worktrees'));
  });

  test('typos excludes them', () => {
    const line = read('typos.toml').match(/^extend-exclude = (\[.*\])$/m);
    assert.ok(JSON.parse(line[1]).includes('.claude/worktrees/'));
  });

  test('git, Semgrep and CodeQL ignore them', () => {
    assert.match(read('.gitignore'), /^\/\.claude\/worktrees\/$/m);
    assert.match(read('.semgrepignore'), /^\.claude\/worktrees\/$/m);
    // paths-ignore; `make check-codeql` turns the same list into index filters.
    assert.match(read('.github/codeql/codeql-config.yml'), /^ {2}- \.claude\/worktrees(\s|$)/m);
  });
});
