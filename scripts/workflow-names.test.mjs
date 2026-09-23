// GitHub Actions reads only the top level of .github/workflows, so a filename
// prefix is the only grouping the directory has. The prefix and the display
// name say the same thing: `ci.yml` and `ci-*.yml` run on every change and show
// as `CI` / `CI / ...`; `cd-*.yml` make releases and show as `CD / ...`. The
// directory then sorts the way the Actions sidebar does, and a new workflow
// cannot land outside both groups.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

/** The top-level `name:` of a workflow file, unquoted. */
function displayName(file) {
  const line = readFileSync(path.join(dir, file), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('name:'));
  assert.ok(line, `${file} has no top-level name:`);
  return line
    .slice('name:'.length)
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

test('the workflow directory is not empty', () => {
  // A glob that matches nothing would pass every test below.
  assert.ok(files.length >= 10, `read only ${files.length} workflow files from ${dir}`);
});

test('every workflow file is ci.yml, ci-*.yml or cd-*.yml, spelled .yml', () => {
  const bad = files.filter((f) => f !== 'ci.yml' && !/^(ci|cd)-[a-z0-9-]+\.yml$/.test(f));
  assert.deepEqual(bad, [], `workflow files outside the ci-/cd- groups: ${bad.join(', ')}`);
});

test("every workflow's display name matches its prefix", () => {
  const bad = [];
  for (const file of files) {
    const name = displayName(file);
    const want = file === 'ci.yml' ? /^CI$/ : file.startsWith('ci-') ? /^CI \/ \S/ : /^CD \/ \S/;
    if (!want.test(name)) bad.push(`${file}: "${name}"`);
  }
  assert.deepEqual(
    bad,
    [],
    `display names that do not match the filename prefix: ${bad.join('; ')}`,
  );
});
