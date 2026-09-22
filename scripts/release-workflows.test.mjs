// The release path must run as far as it can without an App Store Connect or
// Play account.
//
// It did not. Every stage chained its GitHub release behind its store uploads —
// `github-prerelease` needed `upload-ios` and `upload-android`, and neither
// upload job carried a condition — so without credentials nothing past the
// native builds ran, including the release itself, which needs only the default
// token. On a template that fires `release-internal` on every push to `main`,
// that meant an adopter's first commit went red after paying for a macOS build.
//
// The gating is invisible in review: a `needs:` list looks identical whether or
// not it silently blocks half a pipeline, and an absent `if:` looks like
// nothing at all. Hence this file.
//
// No YAML library: the template ships none, and `yq` is not pinned in its
// .mise.toml, so a CI runner would not have it. The parser below is small and
// deliberately self-checking — every test asserts it found the jobs it expects
// before asserting anything about them, so a parse that silently yields nothing
// fails rather than passes.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const GATE = 'STORE_UPLOADS_ENABLED';

/** Top-level jobs of a workflow: name -> { if, needs, uses, with } as raw text. */
function parseJobs(file) {
  const lines = readFileSync(path.join(root, '.github/workflows', file), 'utf8').split('\n');
  const start = lines.findIndex((l) => l === 'jobs:');
  assert.notEqual(start, -1, `${file} has no jobs: block`);
  const jobs = {};
  let name = null;
  for (const line of lines.slice(start + 1)) {
    const header = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (header) {
      name = header[1];
      jobs[name] = { if: '', needs: '', uses: '', body: [] };
      continue;
    }
    if (!name) continue;
    // A line indented by two spaces that is not a job header ends the block
    // only if it is at column 0; everything deeper belongs to the current job.
    if (/^\S/.test(line) && line.trim() !== '') break;
    jobs[name].body.push(line);
    const key = /^ {4}(if|needs|uses):\s*(.*)$/.exec(line);
    if (key) jobs[name][key[1]] = key[2].trim();
  }
  return jobs;
}

const WORKFLOWS = {
  'release-internal.yml': {
    storeJobs: ['upload-ios', 'upload-android', 'upload-huawei'],
    releaseJobs: ['github-prerelease'],
  },
  'release-beta.yml': {
    storeJobs: ['promote-ios', 'promote-android', 'huawei-binary', 'promote-huawei'],
    releaseJobs: ['github-release'],
  },
  'release-production.yml': {
    storeJobs: [
      'ios-release',
      'android-release',
      'ios-phased',
      'android-rollout',
      'android-halt',
      'huawei-binary',
      'huawei-release',
    ],
    releaseJobs: ['github-release'],
  },
};

// release-please.yml chains everything after the cut release by dispatch. It
// has to: the PR, tag and release are created with GITHUB_TOKEN, and GitHub
// never starts a workflow from an event that token caused - except for
// `workflow_dispatch`. A `release: published` trigger anywhere downstream is a
// trigger that never fires (or, with an App token, fires on every `-build.N`
// pre-release too).
// `workflow_run` filters name the *display name* of the workflow they follow,
// not its file. Renaming a workflow silently disconnects every listener - the
// beta retry listened for "release-internal" for two days after that workflow
// became "CD / Internal" and never fired. So every listener must name a
// workflow that exists.
describe('every workflow_run listener names a workflow that exists', () => {
  const dir = path.join(root, '.github/workflows');
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml'));
  const names = new Set(
    files
      .map((f) => readFileSync(path.join(dir, f), 'utf8').match(/^name:\s*(.+?)\s*$/m)?.[1])
      .filter(Boolean),
  );
  for (const file of files) {
    const text = readFileSync(path.join(dir, file), 'utf8');
    const m = text.match(/^\s+workflows:\s*\[([^\]]+)\]/m);
    if (!m) continue;
    test(`${file} follows workflows that exist`, () => {
      for (const wanted of m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''))) {
        assert.ok(
          names.has(wanted),
          `${file} listens for "${wanted}", but no workflow has that name (have: ${[...names].join(', ')})`,
        );
      }
    });
  }
});

// GitHub keeps one *pending* run per concurrency group and evicts the older
// one. release-internal waits ~35 minutes in Prepare for the commit's CI
// before it builds, so on the shared `release` queue any push inside that
// window lost its internal build - and the release's beta then failed its
// green gate (v0.2.3, v0.2.4, v0.2.5). Internal therefore queues per commit,
// and only its store-touching jobs join the shared queue, one job at a time.
describe('the internal release queues per commit; only its store jobs share the release queue', () => {
  const dir = path.join(root, '.github/workflows');
  const strip = (file) =>
    readFileSync(path.join(dir, file), 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');
  const topGroup = (text) =>
    text.match(/^concurrency:\n(?: {2}[^\n]*\n)*? {2}group: ([^\n]+)/m)?.[1];

  test('release-internal.yml is keyed on the commit', () => {
    assert.match(topGroup(strip('release-internal.yml')) ?? '', /github\.sha/);
  });

  test('CI on main is keyed on the commit too, so a merge never evicts the previous one', () => {
    const group = topGroup(strip('ci.yml')) ?? '';
    assert.match(group, /github\.sha/);
    assert.match(group, /github\.ref == 'refs\/heads\/main' &&/);
  });

  test('the promoting workflows still share the literal release queue', () => {
    for (const file of ['release-beta.yml', 'release-production.yml', 'ota-hotfix.yml']) {
      assert.equal(topGroup(strip(file)), 'release', `${file} left the release queue`);
    }
  });

  test('exactly the store-touching internal jobs join the release queue, per job', () => {
    const text = strip('release-internal.yml');
    const jobs = {};
    let current = null;
    for (const line of text.split('\n')) {
      const header = line.match(/^ {2}([a-z][a-z0-9-]*):\s*$/);
      if (header) {
        current = header[1];
        jobs[current] = '';
      } else if (current && /^ {4}/.test(line)) jobs[current] += `${line}\n`;
    }
    const queued = Object.entries(jobs)
      .filter(([, body]) => /^ {4}concurrency:\n {6}group: release\n/m.test(body))
      .map(([id]) => id)
      .sort();
    assert.deepEqual(queued, ['ota-internal', 'upload-android', 'upload-huawei', 'upload-ios']);
  });
});

// The beta gate must heal itself: when the release commit's internal run is
// missing or red it dispatches one at the tag, which needs actions: write on
// the calling job. Without both, a release merged at the wrong moment waits
// for a human - which is what happened on v0.2.3, v0.2.4 and v0.2.5.
describe('the beta gate dispatches the build it is missing', () => {
  const text = readFileSync(path.join(root, '.github/workflows/release-beta.yml'), 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');
  const prepare = text.slice(text.indexOf('\n  prepare:'), text.indexOf('\n  promote-ios:'));

  test('prepare asks the gate to dispatch, at the release tag', () => {
    assert.match(prepare, /require-green-workflow: release-internal\.yml/);
    assert.match(prepare, /require-green-dispatch: true/);
    assert.match(prepare, /release-tag: \$\{\{ inputs\.tag \}\}/);
  });

  test('the internal release reserves its build tag at push time, with contents: write', () => {
    // GitHub refuses GITHUB_TOKEN a new tag on a commit whose workflow files
    // differ from main's tip; an hour after the push that is often the case.
    const internal = readFileSync(path.join(root, '.github/workflows/release-internal.yml'), 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');
    const prep = internal.slice(
      internal.indexOf('\n  prepare:'),
      internal.indexOf('\n  build-ios:'),
    );
    assert.match(prep, /reserve-tag: true/);
    assert.match(prep, /^\s+contents: write$/m);
  });

  test('prepare grants actions: write, which the dispatch needs', () => {
    assert.match(prepare, /^\s+actions: write$/m);
  });
});

describe('release-please.yml chains the release by dispatch', () => {
  const dir = path.join(root, '.github/workflows');
  const rp = readFileSync(path.join(dir, 'release-please.yml'), 'utf8');
  const code = rp
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');

  test('the job may write to the Actions API', () => {
    assert.match(code, /^\s+actions: write$/m, 'release-please.yml lacks actions: write');
  });

  test('a cut release dispatches release-beta and web at the tag', () => {
    for (const wf of ['release-beta.yml', 'web.yml']) {
      const step = new RegExp(
        `release_created == 'true'[\\s\\S]*?gh workflow run ${wf.replace('.', '\\.')} [^\n]*--ref "\\$TAG"`,
      );
      assert.match(code, step, `no dispatch of ${wf} gated on release_created`);
    }
    assert.match(code, /gh workflow run release-beta\.yml [^\n]*-f "tag=\$TAG"/);
    assert.match(code, /gh workflow run web\.yml [^\n]*-f "deploy=true"/);
  });

  test('a created or updated release PR gets a CI run', () => {
    assert.match(
      code,
      /prs_created == 'true'[\s\S]*?gh workflow run ci\.yml [^\n]*--ref "\$BRANCH"/,
      'no CI dispatch gated on prs_created',
    );
    // Parsed in the shell on purpose: `fromJSON()` in `env:` is validated even
    // when the step's `if` is false, and the output is empty on a push that
    // produces no release PR.
    assert.doesNotMatch(code, /fromJSON\(steps\.release\.outputs\.pr\)/);
    assert.match(code, /PR_JSON: \$\{\{ steps\.release\.outputs\.pr \}\}/);
    assert.match(code, /jq -r '\.headBranchName \/\/ empty'/);
  });

  test('the release PR number and branch are parsed once, in the shell, as job outputs', () => {
    assert.match(code, /jq -r '\.number \/\/ empty'/, 'the PR number is not parsed');
    assert.match(code, /pr-number: \$\{\{ steps\.pr\.outputs\.number \}\}/);
    assert.match(code, /pr-branch: \$\{\{ steps\.pr\.outputs\.branch \}\}/);
  });

  test('a second job drafts the store notes into the release PR through shared-workflows', () => {
    const job =
      /store-notes:\n\s+name: Store Notes\n\s+needs: release-please\n[\s\S]*?uses: [^\n]*\/shared-workflows\/\.github\/workflows\/release-pr-notes\.yml@v0/;
    assert.match(code, job, 'no store-notes job calling release-pr-notes.yml');
    assert.match(code, /if: \$\{\{ needs\.release-please\.outputs\.pr-number != '' \}\}/);
    assert.match(code, /pull-requests: write/);
    assert.match(code, /pr-number: \$\{\{ needs\.release-please\.outputs\.pr-number \}\}/);
    assert.match(code, /ref: \$\{\{ needs\.release-please\.outputs\.pr-branch \}\}/);
    for (const name of [
      'STORE_NOTES_INCLUDE_CHANGELOG',
      'RELEASE_NOTES_LLM_PROVIDER',
      'RELEASE_NOTES_LLM_MODEL',
      'OPENAI_BASE_URL',
    ]) {
      assert.match(
        code,
        new RegExp(`"${name}":"\\$\\{\\{ vars\\.${name} \\}\\}"`),
        `${name} not in build-env`,
      );
    }
    for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
      assert.match(
        code,
        new RegExp(`${key}: \\$\\{\\{ secrets\\.${key} \\}\\}`),
        `${key} not passed`,
      );
    }
  });

  test('the section title the release PR gets is the one beta appends', () => {
    const beta = readFileSync(path.join(dir, 'release-beta.yml'), 'utf8');
    const title = /append-title: (.+)/.exec(beta)?.[1];
    assert.equal(title, 'Store notes');
    // The shared workflow defaults to the same title; passing none keeps them equal.
    assert.doesNotMatch(code, /section-title:/);
  });

  test('the LLM runs only in the release PR job, never in a CD lane', () => {
    for (const file of ['release-internal.yml', 'release-beta.yml', 'release-production.yml']) {
      const text = readFileSync(path.join(dir, file), 'utf8')
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('#'))
        .join('\n');
      for (const name of [
        'RELEASE_NOTES_LLM_PROVIDER',
        'RELEASE_NOTES_LLM_MODEL',
        'OPENAI_BASE_URL',
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
      ]) {
        assert.doesNotMatch(text, new RegExp(name), `${file} still carries ${name}`);
      }
      // Internal still generates notes from commits; beta and production copy
      // the reviewed section verbatim, so only internal may append the changelog.
      if (file === 'release-internal.yml') {
        assert.match(text, /STORE_NOTES_INCLUDE_CHANGELOG/);
      } else {
        assert.doesNotMatch(
          text,
          /STORE_NOTES_INCLUDE_CHANGELOG/,
          `${file} still appends the changelog`,
        );
      }
    }
  });

  test('nothing downstream waits on a release event, and no App token remains', () => {
    for (const file of ['release-beta.yml', 'web.yml']) {
      const text = readFileSync(path.join(dir, file), 'utf8')
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('#'))
        .join('\n');
      assert.doesNotMatch(text, /^\s+release:\s*$/m, `${file} still triggers on release:`);
      assert.match(text, /^\s+workflow_dispatch:\s*$/m, `${file} cannot be dispatched`);
    }
    const beta = readFileSync(path.join(dir, 'release-beta.yml'), 'utf8');
    assert.match(beta, /tag:\n\s+description:[^\n]*\n\s+type: string\n\s+required: true/);
    for (const file of [
      'release-please.yml',
      'release-internal.yml',
      'release-beta.yml',
      'release-production.yml',
      'web.yml',
    ]) {
      const text = readFileSync(path.join(dir, file), 'utf8');
      assert.doesNotMatch(
        text,
        /RELEASE_TAGGER|create-github-app-token/,
        `${file} still references the App`,
      );
    }
  });
});

describe('the release path without a store account', () => {
  for (const [file, spec] of Object.entries(WORKFLOWS)) {
    describe(file, () => {
      const jobs = parseJobs(file);

      test('the parser found the jobs this file is supposed to have', () => {
        // Guards every assertion below: a parser that silently returns nothing
        // would make all of them pass.
        for (const name of [...spec.storeJobs, ...spec.releaseJobs]) {
          assert.ok(jobs[name], `${file} has no job named ${name} — the parser or the file moved`);
        }
      });

      test('every job that talks to a store is gated', () => {
        for (const name of spec.storeJobs) {
          assert.match(
            jobs[name].if,
            new RegExp(GATE),
            `${name} would run without store credentials and fail deep inside a fastlane lane`,
          );
        }
      });

      test('the release job survives its store jobs being skipped', () => {
        for (const name of spec.releaseJobs) {
          // A skipped dependency skips its dependents unless the condition uses
          // a status function. Without this the gate above would take the
          // GitHub release down with the uploads.
          assert.match(
            jobs[name].if,
            /!cancelled\(\)/,
            `${name} has no status function in its if, so a skipped upload skips it too`,
          );
        }
      });

      test('the release job does not reach its artifacts only through a store job', () => {
        for (const name of spec.releaseJobs) {
          const needs = jobs[name].needs;
          assert.ok(needs.length > 0, `${name} declares no needs`);
          const onlyStore = spec.storeJobs.some((s) => needs.includes(s));
          const alsoOther = /prepare|build-ios|build-android/.test(needs);
          assert.ok(
            !onlyStore || alsoOther,
            `${name} reaches its artifacts only through store jobs (${needs}); name the jobs that actually produce them`,
          );
        }
      });

      test('signing is derived so that uploading implies something to upload', () => {
        // Only release-internal builds; beta and production promote what it
        // produced, so they have no signing inputs to derive.
        if (file !== 'release-internal.yml') return;
        for (const [job, input, variable] of [
          ['build-ios', 'ios-signing', 'IOS_SIGNING_ENABLED'],
          ['build-android', 'android-signing', 'ANDROID_SIGNING_ENABLED'],
        ]) {
          const body = jobs[job].body.filter((l) => !l.trimStart().startsWith('#')).join('\n');
          assert.match(body, new RegExp(`${input}:`), `${job} does not pass ${input}`);
          // Both halves of the OR. Without the uploads term, someone could turn
          // uploads on and leave signing off, and the upload job would look for
          // an artifact the build never produced.
          assert.match(
            body,
            new RegExp(`${GATE}\\s*==\\s*'true'\\s*\\|\\|`),
            `${job}'s ${input} does not treat uploads as implying signing`,
          );
          assert.match(
            body,
            new RegExp(`${variable}\\s*==\\s*'true'`),
            `${job}'s ${input} ignores ${variable}, so signing cannot be turned on without uploading`,
          );
        }
      });

      test('a release created without uploads says so in its body', () => {
        for (const name of spec.releaseJobs) {
          // Comments stripped first: the workflows explain this very pitfall in
          // prose, and prose read as code is a false positive. The same trap
          // caught the workflows repo's own version of this check.
          const body = jobs[name].body.filter((l) => !l.trimStart().startsWith('#')).join('\n');
          assert.match(body, /body-note:/, `${name} creates a release with no marker`);
          // GitHub's `&&` yields its first falsy operand, so `cond && '' || X`
          // is X on both branches and every release would carry the marker.
          // The non-empty value has to sit in the `&&` slot.
          assert.doesNotMatch(
            body,
            /&&\s*''\s*\|\|/,
            `${name} puts the empty string in the && slot, so every release would be marked`,
          );
          assert.match(
            body,
            new RegExp(`${GATE}\\s*!=\\s*'true'\\s*&&`),
            `${name}'s marker condition is not inverted; it would mark the wrong builds`,
          );
        }
      });
    });
  }
});
