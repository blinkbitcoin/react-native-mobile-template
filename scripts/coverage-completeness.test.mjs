// The script coverage gate (`pnpm test:scripts`, 100% lines, branches and
// functions) only measures modules some test loads: a module no test imports
// is missing from the report rather than reported at 0%. Loading every module
// here puts each one in the report, so an untested new script fails the gate
// instead of slipping past it. Every module's command-line entry is guarded by
// `import.meta.main`, so importing one runs nothing.
import assert from 'node:assert/strict';
import { globSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const scriptModules = () =>
  globSync('**/*.mjs', { cwd: here })
    .filter((file) => !file.endsWith('.test.mjs'))
    .sort();

test('every script module loads without running its command-line entry', async () => {
  const modules = scriptModules();
  assert.ok(modules.length > 0, 'no script modules found');
  for (const file of modules) {
    const loaded = await import(pathToFileURL(path.join(here, file)).href);
    assert.equal(typeof loaded, 'object', file);
  }
});

test('test files are not counted as modules', () => {
  assert.ok(scriptModules().every((file) => !file.endsWith('.test.mjs')));
  assert.ok(scriptModules().includes('ports.mjs'));
});
