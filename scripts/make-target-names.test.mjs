// A make target is named for what it checks or does, never after the tool that
// does it: `check-unused`, not `check-knip`. A tool's name tells a reader
// nothing until they already know the tool; it belongs in the target's `##`
// description, where `make help` shows it beside the name (see AGENTS.md).
//
// The tools are the ones this repository pins in `.mise.toml` and the unscoped
// packages in `package.json`. A scoped package is left out: its last segment
// is often a plain word like `client` (`@apollo/client`) rather than a tool's name.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

/** Targets whose name may hold a tool's word, each with the reason. */
const ALLOWED = new Map([
  ['gen-graphql', 'GraphQL is what it generates, the typed documents, not the tool that does it'],
]);

/** The `##`-documented targets of a Makefile, the ones `make help` lists. */
function documentedTargets(makefile) {
  return [...makefile.matchAll(/^([a-zA-Z0-9_-]+):[^#\n]*## /gm)].map((match) => match[1]);
}

/** The tools a `.mise.toml` pins: its [tools] keys, without a backend prefix. */
function miseTools(toml) {
  const tools = toml.split(/^\[/m).find((section) => section.startsWith('tools]')) ?? '';
  return tools
    .split('\n')
    .slice(1)
    .map((line) => line.match(/^"?([^"=\s]+)"?\s*=/)?.[1])
    .filter(Boolean)
    .map((name) =>
      name
        .replace(/^[a-z]+:/, '')
        .split('/')
        .pop(),
    );
}

/** The unscoped package names a package.json depends on. */
function packageNames(pkg) {
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(
    (name) => !name.startsWith('@'),
  );
}

/** `target (word)` for each target with a dash-separated word that is a tool's name. */
function namedAfterTools(targets, tools, allowed) {
  const names = new Set(tools);
  return targets
    .filter((target) => !target.startsWith('setup-') && !allowed.has(target))
    .flatMap((target) => {
      const word = target.split('-').find((part) => names.has(part));
      return word ? [`${target} (${word})`] : [];
    });
}

const tools = [...miseTools(read('.mise.toml')), ...packageNames(JSON.parse(read('package.json')))];
const targets = documentedTargets(read('Makefile'));

test('no make target is named after the tool it runs', () => {
  assert.deepEqual(
    namedAfterTools(targets, tools, ALLOWED),
    [],
    'name each target for what it checks; the tool goes in its ## description',
  );
});

describe('the rule', () => {
  test('reads the documented targets, not the undocumented ones', () => {
    const makefile =
      'check-unused: ## Unused code\n\tpnpm knip\nhidden:\n\ttrue\nci: check ## All\n';
    assert.deepEqual(documentedTargets(makefile), ['check-unused', 'ci']);
    assert.ok(targets.includes('check-unused'));
  });

  test("reads .mise.toml's tools, with and without a backend prefix", () => {
    const toml =
      '[env]\nA = "1"\n[tools]\nnode = "24"\n"pypi:mobsfscan" = "1"\n"aqua:org/zizmor" = "1"\n[settings]\nx = 1\n';
    assert.deepEqual(miseTools(toml), ['node', 'mobsfscan', 'zizmor']);
    assert.deepEqual(miseTools('[env]\nA = "1"\n'), []);
    assert.ok(tools.includes('zizmor'));
  });

  test('takes the unscoped packages from dependencies and devDependencies', () => {
    const pkg = {
      dependencies: { expo: '1', '@apollo/client': '1' },
      devDependencies: { knip: '1' },
    };
    assert.deepEqual(packageNames(pkg), ['expo', 'knip']);
    assert.deepEqual(packageNames({}), []);
  });

  test('names a target with a tool word, and spares setup- targets and the allowed ones', () => {
    const found = namedAfterTools(
      ['check-knip', 'zizmor', 'check-unused', 'setup-maestro', 'gen-graphql'],
      ['knip', 'zizmor', 'maestro', 'graphql'],
      new Map([['gen-graphql', 'the thing generated']]),
    );
    assert.deepEqual(found, ['check-knip (knip)', 'zizmor (zizmor)']);
  });

  test('every allowed target exists, is still named after a tool, and says why', () => {
    for (const [target, reason] of ALLOWED) {
      assert.ok(reason.trim(), `${target} needs a reason`);
      assert.ok(targets.includes(target), `${target} is not a make target any more; remove it`);
      assert.equal(
        namedAfterTools([target], tools, new Map()).length,
        1,
        `${target} no longer needs the entry`,
      );
    }
  });
});
