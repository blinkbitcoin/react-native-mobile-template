// Every call this repository's workflows make into shared-workflows, checked
// against the interface the called workflow declares at the pinned commit. A
// caller and its callee live in two repositories: a renamed input, a dropped
// secret or a required input nobody passes is otherwise found by the first CD
// run on main - for the release lanes, that is a release.
//
// The pins are checked everywhere. The interfaces need the shared code itself:
// in CI it is the checkout this run's workflows were called at ($WORKFLOWS_DIR,
// exported by the setup action), and the pinned commit must be exactly that
// checkout, so a Dependabot bump is verified against the code it moves to.
// Locally the interface cases skip unless $WORKFLOWS_DIR points at a checkout
// (`WORKFLOWS_DIR=../shared-workflows make test-scripts`); in CI a missing one
// fails, because a contract checked against nothing is what this file prevents.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { callsIn, contractProblems, interfaceOf, pinsIn } from './lib/workflow-calls.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflowsDir = path.join(root, '.github', 'workflows');
const callers = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml'))
  .sort()
  .map((name) => ({ name, text: readFileSync(path.join(workflowsDir, name), 'utf8') }));

/** The shared-workflows checkout to read callees from, or why there is none. */
function sharedCheckout() {
  const dir = process.env.WORKFLOWS_DIR;
  if (!dir) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      throw new Error(
        'WORKFLOWS_DIR is not set in CI - the setup action exports it; without it no call was checked against its workflow',
      );
    }
    return {
      skip: 'WORKFLOWS_DIR not set: calls were NOT checked against shared-workflows (set it to a checkout to check them)',
    };
  }
  return { dir: path.resolve(dir) };
}

const pins = callers.flatMap(({ name, text }) =>
  pinsIn(text).map((pin) => ({ ...pin, file: name })),
);

test('the workflows call shared-workflows at all', () => {
  assert.ok(pins.length > 0, 'no shared-workflows call found - did the pin format change?');
});

test('every shared call is pinned to one commit, with the version beside it', () => {
  const where = (pin) => `${pin.file}:${pin.line}`;
  for (const pin of pins) {
    assert.match(pin.ref, /^[0-9a-f]{40}$/, `${where(pin)} is not pinned to a full commit SHA`);
    assert.match(pin.comment, /^v\d+\.\d+\.\d+$/, `${where(pin)} has no "# vX.Y.Z" beside its pin`);
  }
  const refs = new Set(pins.map((pin) => `${pin.ref} # ${pin.comment}`));
  assert.equal(
    refs.size,
    1,
    `the shared calls are pinned to more than one commit: ${[...refs].join(', ')} - CI would test one and CD run another`,
  );
});

test('the pinned commit is the shared-workflows checkout this run tests against', (t) => {
  const shared = sharedCheckout();
  if (shared.skip) return t.skip(shared.skip);
  const head = execFileSync('git', ['-C', shared.dir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  assert.equal(
    pins[0].ref,
    head,
    `the workflows pin ${pins[0].ref} but WORKFLOWS_DIR is at ${head}: the contract below would describe other code`,
  );
});

for (const { name, text } of callers) {
  const calls = callsIn(text);
  if (calls.length === 0) continue;
  describe(name, () => {
    for (const call of calls) {
      test(`${call.job} calls ${call.workflow} within its declared interface`, (t) => {
        const shared = sharedCheckout();
        if (shared.skip) return t.skip(shared.skip);
        const file = path.join(shared.dir, '.github', 'workflows', call.workflow);
        assert.ok(existsSync(file), `${call.workflow} does not exist in shared-workflows`);
        assert.deepEqual(contractProblems(call, interfaceOf(readFileSync(file, 'utf8'))), []);
      });
    }
  });
}
