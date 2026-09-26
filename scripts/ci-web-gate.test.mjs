// ci-web.yml leaves the web gate to the workflow it calls. build-web.yml runs
// the same classifier as ci.yml's checks in its own Changes job and skips
// Build, E2E and Deploy when no changed file can reach the web export
// (`web-changed`). A gate here could only read outputs of a job that has not
// run yet. `make init --no-web` deletes this file with ci-web.yml.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflow = (file) => readFileSync(path.join(root, '.github', 'workflows', file), 'utf8');
const web = parse(workflow('ci-web.yml'));

/** An expression without its `${{ }}`. */
const unwrap = (expression) => /^\$\{\{\s*([\s\S]*?)\s*\}\}$/.exec(expression)[1];

describe('ci-web.yml leaves the web gate to build-web.yml', () => {
  test('the web job carries no if: of its own', () => {
    assert.equal(web.jobs.web.if, undefined);
  });

  test("the tag's deploy dispatch is a workflow_dispatch, which the classifier cannot diff", (t) => {
    // cd-release.yml dispatches ci-web.yml at the tag with deploy=true. The
    // classifier's base is the PR's base on a pull_request and
    // github.event.before otherwise, and a dispatch has no `before`: no base,
    // so it fails open and the deploy always builds. Checked against the pinned
    // build-web.yml when WORKFLOWS_DIR points at it, as workflow-contract does.
    assert.ok(Object.hasOwn(web.on, 'workflow_dispatch'));
    assert.match(workflow('cd-release.yml'), /gh workflow run ci-web\.yml .*-f "deploy=true"/);
    const dir = process.env.WORKFLOWS_DIR;
    if (!dir) {
      assert.notEqual(process.env.GITHUB_ACTIONS, 'true', 'WORKFLOWS_DIR is not set in CI');
      return t.skip('WORKFLOWS_DIR not set: build-web.yml was NOT read');
    }
    const file = path.join(dir, '.github', 'workflows', 'build-web.yml');
    assert.ok(existsSync(file), 'build-web.yml does not exist in shared-workflows');
    const steps = parse(readFileSync(file, 'utf8')).jobs.changes.steps;
    const base = unwrap(steps.find((step) => step.env?.BASE_SHA).env.BASE_SHA);
    assert.equal(
      base,
      "github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before",
      'the classifier base changed: re-check that a dispatch still fails open',
    );
  });
});

// The web half of the release hop that release-workflows.test.mjs pins for
// cd-beta.yml. It lives here because `make init --no-web` deletes this file,
// ci-web.yml and the cd-release.yml step that dispatches it, together.
describe('cd-release.yml dispatches the web deploy at a cut release', () => {
  const steps = parse(workflow('cd-release.yml')).jobs['release-please'].steps;
  const dispatches = steps.filter((step) => /gh workflow run ci-web\.yml /.test(step.run ?? ''));

  test('one step, gated on release_created, at the tag, with deploy=true', () => {
    assert.equal(dispatches.length, 1, 'expected exactly one dispatch of ci-web.yml');
    const [step] = dispatches;
    assert.equal(unwrap(step.if), "steps.release.outputs.release_created == 'true'");
    assert.match(step.run, /--ref "\$TAG"/);
    assert.match(step.run, /-f "deploy=true"/);
  });

  test('ci-web.yml waits on no release event and uses no App token', () => {
    assert.equal(Object.hasOwn(web.on, 'release'), false, 'ci-web.yml still triggers on release:');
    assert.doesNotMatch(workflow('ci-web.yml'), /RELEASE_TAGGER|create-github-app-token/);
  });
});
