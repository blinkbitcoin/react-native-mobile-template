// The release path must run as far as it can without an App Store Connect or
// Play account.
//
// It did not. Every stage chained its GitHub release behind its store uploads —
// `github-prerelease` needed `upload-ios` and `upload-android`, and neither
// upload job carried a condition — so without credentials nothing past the
// native builds ran, including the release itself, which needs only the default
// token. On a template that fires `cd-internal` on every push to `main`,
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
import { parse } from 'yaml';

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
  'cd-internal.yml': {
    storeJobs: ['upload-ios', 'upload-android', 'upload-huawei'],
    releaseJobs: ['github-prerelease'],
  },
  'cd-beta.yml': {
    storeJobs: ['promote-ios', 'promote-android', 'promote-huawei'],
    releaseJobs: ['github-release'],
  },
  'cd-production.yml': {
    storeJobs: [
      'ios-release',
      'android-release',
      'ios-phased',
      'android-rollout',
      'android-halt',
      'huawei-release',
    ],
    releaseJobs: ['github-release'],
  },
};

// cd-release.yml chains everything after the cut release by dispatch. It
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
// one. cd-internal waits ~35 minutes in Prepare for the commit's CI
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

  test('cd-internal.yml is keyed on the commit', () => {
    assert.match(topGroup(strip('cd-internal.yml')) ?? '', /github\.sha/);
  });

  test('CI on main is keyed on the commit too, so a merge never evicts the previous one', () => {
    const group = topGroup(strip('ci.yml')) ?? '';
    assert.match(group, /github\.sha/);
    assert.match(group, /github\.ref == 'refs\/heads\/main' &&/);
  });

  test('the promoting workflows still share the literal release queue', () => {
    for (const file of ['cd-beta.yml', 'cd-production.yml', 'cd-ota-hotfix.yml']) {
      assert.equal(topGroup(strip(file)), 'release', `${file} left the release queue`);
    }
  });

  test('exactly the store-touching internal jobs join the release queue, per job', () => {
    const text = strip('cd-internal.yml');
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
  const text = readFileSync(path.join(root, '.github/workflows/cd-beta.yml'), 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');
  const prepare = text.slice(text.indexOf('\n  prepare:'), text.indexOf('\n  promote-ios:'));

  test('prepare asks the gate to dispatch, at the release tag', () => {
    assert.match(prepare, /require-green-workflow: cd-internal\.yml/);
    assert.match(prepare, /require-green-dispatch: true/);
    assert.match(prepare, /release-tag: \$\{\{ inputs\.tag \}\}/);
  });

  test('the internal release reserves its build tag at push time, with contents: write', () => {
    // GitHub refuses GITHUB_TOKEN a new tag on a commit whose workflow files
    // differ from main's tip; an hour after the push that is often the case.
    const internal = readFileSync(path.join(root, '.github/workflows/cd-internal.yml'), 'utf8')
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

describe('cd-release.yml chains the release by dispatch', () => {
  const dir = path.join(root, '.github/workflows');
  const rp = readFileSync(path.join(dir, 'cd-release.yml'), 'utf8');
  const code = rp
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');

  // release-please, the dispatches and reading the release PR are
  // shared-workflows' pr-release.yml, tested there; what this repository
  // decides is which of its workflows run, and that the job may start them.
  test('the release job calls pr-release.yml at the pin and may write to the Actions API', () => {
    assert.match(
      code,
      /release-please:\n\s+name: Release\n\s+uses: [^\n]*\/shared-workflows\/\.github\/workflows\/pr-release\.yml@[0-9a-f]{40}\b/,
      'the release-please job does not call pr-release.yml',
    );
    assert.match(code, /^\s+actions: write$/m, 'cd-release.yml lacks actions: write');
    assert.match(code, /^\s+contents: write$/m);
    assert.match(code, /^\s+pull-requests: write$/m);
  });

  // The web deploy's dispatch is pinned in ci-web-gate.test.mjs, which
  // `make init --no-web` deletes together with ci-web.yml and that line.
  test('a cut release dispatches cd-beta at the tag, with the tag as its input', () => {
    const lines = parse(rp)
      .jobs['release-please'].with['dispatch-on-release'].split('\n')
      .map((line) => line.trim());
    assert.ok(
      lines.includes('cd-beta.yml tag={tag}'),
      `no cd-beta.yml line in: ${lines.join(' | ')}`,
    );
  });

  test('a created or updated release PR gets a CI run', () => {
    assert.match(code, /^\s+ci-workflow: ci\.yml$/m);
  });

  test('a second job drafts the store notes into the release PR through shared-workflows', () => {
    const job =
      /store-notes:\n\s+name: Store notes\n\s+needs: release-please\n[\s\S]*?uses: [^\n]*\/shared-workflows\/\.github\/workflows\/pr-store-notes\.yml@[0-9a-f]{40}\b/;
    assert.match(code, job, 'no store-notes job calling pr-store-notes.yml');
    assert.match(code, /if: \$\{\{ needs\.release-please\.outputs\.pr-number != '' \}\}/);
    assert.match(code, /pull-requests: write/);
    assert.match(code, /pr-number: \$\{\{ needs\.release-please\.outputs\.pr-number \}\}/);
    assert.match(code, /ref: \$\{\{ needs\.release-please\.outputs\.pr-branch \}\}/);
    for (const name of [
      'STORE_NOTES_INCLUDE_CHANGELOG',
      'STORE_NOTES_LLM_PROVIDER',
      'STORE_NOTES_LLM_MODEL',
      'STORE_NOTES_LLM_EFFORT',
      'OPENAI_BASE_URL',
    ]) {
      assert.match(
        code,
        new RegExp(`"${name}":"\\$\\{\\{ vars\\.${name} \\}\\}"`),
        `${name} not in environment-variables`,
      );
    }
    // A JSON object inside a JSON string: toJSON quotes and escapes it, where
    // pasting it between "..." would end the environment-variables object at its first
    // quote and fail the job with a parse error.
    assert.match(
      code,
      /"STORE_NOTES_LLM_EXTRA_PARAMS":\$\{\{ toJSON\(vars\.STORE_NOTES_LLM_EXTRA_PARAMS \|\| ''\) \}\}/,
    );
    for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
      assert.match(
        code,
        new RegExp(`${key}: \\$\\{\\{ secrets\\.${key} \\}\\}`),
        `${key} not passed`,
      );
    }
  });

  test('the section title the release PR gets is the one beta appends', () => {
    const beta = readFileSync(path.join(dir, 'cd-beta.yml'), 'utf8');
    const title = /append-title: (.+)/.exec(beta)?.[1];
    assert.equal(title, 'Store notes');
    // The shared workflow defaults to the same title; passing none keeps them equal.
    assert.doesNotMatch(code, /section-title:/);
  });

  test('the LLM runs only in the release PR job, never in a CD lane', () => {
    for (const file of ['cd-internal.yml', 'cd-beta.yml', 'cd-production.yml']) {
      const text = readFileSync(path.join(dir, file), 'utf8')
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('#'))
        .join('\n');
      for (const name of [
        'STORE_NOTES_LLM_PROVIDER',
        'STORE_NOTES_LLM_MODEL',
        'STORE_NOTES_LLM_EFFORT',
        'STORE_NOTES_LLM_EXTRA_PARAMS',
        'OPENAI_BASE_URL',
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
      ]) {
        assert.doesNotMatch(text, new RegExp(name), `${file} still carries ${name}`);
      }
      // Internal still generates notes from commits; beta and production copy
      // the reviewed section verbatim, so only internal may append the changelog.
      if (file === 'cd-internal.yml') {
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
    const beta = readFileSync(path.join(dir, 'cd-beta.yml'), 'utf8');
    const betaCode = beta
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');
    assert.doesNotMatch(betaCode, /^\s+release:\s*$/m, 'cd-beta.yml still triggers on release:');
    assert.match(betaCode, /^\s+workflow_dispatch:\s*$/m, 'cd-beta.yml cannot be dispatched');
    assert.match(beta, /tag:\n\s+description:[^\n]*\n\s+type: string\n\s+required: true/);
    for (const file of ['cd-release.yml', 'cd-internal.yml', 'cd-beta.yml', 'cd-production.yml']) {
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
        // Only cd-internal builds; beta and production promote what it
        // produced, so they have no signing inputs to derive.
        if (file !== 'cd-internal.yml') return;
        for (const [job, input, variable] of [
          ['build-ios', 'ios-signing-enabled', 'IOS_SIGNING_ENABLED'],
          ['build-android', 'android-signing-enabled', 'ANDROID_SIGNING_ENABLED'],
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

// The security gate has two callers. Each tier turns on what exists there -
// source on every change, the release's built binaries at the production
// dispatch - and the production store jobs cannot start until it has passed.
// Both halves are easy to break invisibly: a `needs:` that loses `security`
// ships an unchecked release, and a condition that uses the implicit
// success() makes every dispatch with the gate switched off skip its stores.
describe('the security gate', () => {
  const dir = path.join(root, '.github/workflows');
  const code = (file) =>
    readFileSync(path.join(dir, file), 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');
  const RELEASE_PR = "startsWith(github.ref_name, 'release-please--')";

  describe('ci.yml', () => {
    const jobs = parseJobs('ci.yml');
    const body = () => jobs.security.body.filter((l) => !l.trimStart().startsWith('#')).join('\n');

    test('calls check-security.yml after checks, and is skipped for docs or by the master switch', () => {
      assert.ok(jobs.security, 'ci.yml has no security job');
      assert.match(
        jobs.security.uses,
        /shared-workflows\/\.github\/workflows\/check-security\.yml@[0-9a-f]{40}\b/,
      );
      assert.equal(jobs.security.needs, 'checks');
      assert.match(jobs.security.if, /needs\.checks\.outputs\.docs-only != 'true'/);
      assert.match(jobs.security.if, /vars\.SECURITY_ENABLED != 'false'/);
    });

    test('grants exactly what the verdict needs to upload to code scanning', () => {
      assert.match(
        body(),
        /permissions:\n\s+contents: read\n\s+actions: read\n\s+security-events: write/,
      );
    });

    test('recognises the release pull request by its branch, never by head_ref', () => {
      // cd-release.yml's pr-release.yml starts the release PR's CI with
      // `gh workflow run --ref`: a workflow_dispatch, where github.head_ref is empty.
      assert.doesNotMatch(body(), /head_ref/);
      for (const input of ['bundle', 'review-codebase', 'review-full-range']) {
        assert.ok(
          body().includes(`${input}: \${{ ${RELEASE_PR} }}`),
          `${input} is not switched on by the release pull request's branch`,
        );
      }
      assert.ok(
        body().includes(`review: \${{ github.event_name == 'pull_request' || ${RELEASE_PR} }}`),
        'review does not run on pull requests and the release pull request',
      );
    });

    test('leaves the source scanners at their default (on) and the production-only ones off', () => {
      for (const input of [
        'dependencies',
        'code',
        'policy',
        'binaries',
        'mobile',
        'sbom',
        'release-tag',
      ]) {
        assert.doesNotMatch(body(), new RegExp(`^\\s+${input}:`, 'm'), `ci.yml sets ${input}`);
      }
    });

    test('passes the LLM settings as environment-variables and the keys as secrets', () => {
      for (const name of [
        'SECURITY_LLM_PROVIDER',
        'SECURITY_LLM_MODEL',
        'SECURITY_LLM_EFFORT',
        'OPENAI_BASE_URL',
      ]) {
        assert.ok(
          body().includes(`"${name}":"\${{ vars.${name} }}"`),
          `${name} not in environment-variables`,
        );
      }
      assert.ok(
        body().includes(
          `"SECURITY_LLM_EXTRA_PARAMS":\${{ toJSON(vars.SECURITY_LLM_EXTRA_PARAMS || '') }}`,
        ),
      );
      for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
        assert.ok(body().includes(`${key}: \${{ secrets.${key} }}`), `${key} not passed`);
      }
    });
  });

  describe('cd-production.yml', () => {
    const jobs = parseJobs('cd-production.yml');
    const body = () => jobs.security.body.filter((l) => !l.trimStart().startsWith('#')).join('\n');

    test('runs on action=release, after prepare, against the tag', () => {
      assert.ok(jobs.security, 'cd-production.yml has no security job');
      assert.match(jobs.security.uses, /check-security\.yml@[0-9a-f]{40}\b/);
      assert.equal(jobs.security.needs, 'prepare');
      assert.match(jobs.security.if, /inputs\.action == 'release'/);
      assert.match(jobs.security.if, /vars\.SECURITY_ENABLED != 'false'/);
      const tag = `\${{ inputs.tag }}`;
      assert.ok(body().includes(`ref: ${tag}`));
      assert.ok(body().includes(`release-tag: ${tag}`));
    });

    test('turns on the binary-side scanners and off the source ones', () => {
      for (const input of ['binaries', 'mobile', 'bundle', 'sbom']) {
        assert.match(body(), new RegExp(`^\\s+${input}: true$`, 'm'), `${input} is not on`);
      }
      for (const input of ['dependencies', 'code', 'policy']) {
        assert.match(body(), new RegExp(`^\\s+${input}: false$`, 'm'), `${input} is not off`);
      }
    });

    test('carries no LLM environment', () => {
      assert.doesNotMatch(
        code('cd-production.yml'),
        /SECURITY_LLM|review:|review-codebase:|OPENAI_API_KEY|ANTHROPIC_API_KEY/,
      );
    });

    test('Huawei waits on the Android release, so the security gate holds it too', () => {
      assert.match(jobs['huawei-release'].needs, /\bandroid-release\b/);
    });

    test('every job that submits a binary waits on it, and survives it being switched off', () => {
      for (const name of ['ios-release', 'android-release']) {
        assert.match(
          jobs[name].needs,
          /\bsecurity\b/,
          `${name} does not wait for the security gate`,
        );
        assert.match(
          jobs[name].if,
          /^\$\{\{ !failure\(\) && !cancelled\(\) && /,
          `${name} uses the implicit success(), so a switched-off gate would skip the release`,
        );
      }
    });
  });
});

// GitHub's push path filter, for the patterns these workflows use: `**`
// matches across directories, `*` within one, a `!` pattern excludes, and the
// last pattern that matches a path decides. Node's own glob matcher differs
// (its `**.md` does not match a nested file), so it cannot stand in.
function pushFilterRuns(patterns, changed) {
  // Split on `**` first, so its halves' single `*`s cannot be mistaken for it.
  const segment = (part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  const toRegExp = (glob) => new RegExp(`^${glob.split('**').map(segment).join('.*')}$`);
  return changed.some((file) => {
    let included = false;
    for (const pattern of patterns) {
      const negated = pattern.startsWith('!');
      if (toRegExp(negated ? pattern.slice(1) : pattern).test(file)) included = !negated;
    }
    return included;
  });
}

describe('cd-internal.yml builds every commit to main except a docs-only one', () => {
  const push = parse(readFileSync(path.join(root, '.github/workflows/cd-internal.yml'), 'utf8')).on
    .push;

  test('it filters with paths, not paths-ignore, which cannot take a pattern back', () => {
    assert.equal(push['paths-ignore'], undefined);
    assert.ok(Array.isArray(push.paths));
  });

  test('a docs-only commit cuts no build', () => {
    assert.equal(
      pushFilterRuns(push.paths, ['docs/ci.md', 'README.md', 'docs/images/a/b.svg']),
      false,
    );
  });

  test('a commit that changes only a prompt builds, in any directory', () => {
    // store-notes.prompt.md feeds the store notes the internal build ships.
    assert.equal(pushFilterRuns(push.paths, ['store-notes.prompt.md']), true);
    assert.equal(pushFilterRuns(push.paths, ['docs/security-review.prompt.md']), true);
  });

  test('a commit that changes code builds, with or without docs beside it', () => {
    assert.equal(pushFilterRuns(push.paths, ['src/app/index.tsx']), true);
    assert.equal(pushFilterRuns(push.paths, ['docs/ci.md', 'package.json']), true);
  });

  test('the filter evaluator follows GitHub: ** crosses directories, * does not', () => {
    assert.equal(pushFilterRuns(['**.md'], ['a/b/README.md']), true);
    assert.equal(pushFilterRuns(['*.md'], ['a/README.md']), false);
    assert.equal(pushFilterRuns(['**', '!a/**'], ['a/x.ts']), false);
  });
});

// The callers stage nothing and write no shell: every step that used to be an
// inline job is an input of a shared workflow.
describe('no CD caller carries an inline job', () => {
  const dir = path.join(root, '.github/workflows');
  const workflow = (file) => parse(readFileSync(path.join(dir, file), 'utf8'));

  for (const file of readdirSync(dir).filter((f) => /^cd-.*\.yml$/.test(f))) {
    test(`${file}: every job calls a shared workflow, so there are no steps to hold`, () => {
      for (const [name, job] of Object.entries(workflow(file).jobs)) {
        const via = job.uses ?? '';
        if (via.includes('/shared-workflows/.github/workflows/')) continue;
        assert.fail(
          `${file}: job ${name} has no shared uses: (${JSON.stringify(Object.keys(job))})`,
        );
      }
    });
  }

  test('the Huawei lanes download the bundle from the release tag', () => {
    for (const [file, job] of [
      ['cd-beta.yml', 'promote-huawei'],
      ['cd-production.yml', 'huawei-release'],
    ]) {
      const huawei = workflow(file).jobs[job].with;
      assert.equal(huawei['release-assets'], '*.aab', `${file} ${job}`);
      assert.equal(huawei['release-tag'], '${{ inputs.tag }}', `${file} ${job}`);
      assert.equal(huawei.artifacts, 'build-info', `${file} ${job}`);
    }
  });

  test("beta's store notes come from build-info, without a staging job", () => {
    const notes = workflow('cd-beta.yml').jobs['store-notes'].with;
    assert.equal(notes.mode, 'append');
    assert.equal(notes['release-notes-artifact'], 'build-info');
    assert.equal(notes['release-notes-file'], 'store-notes.txt');
  });

  test("production's stage note is passed as text, and names the action and the run", () => {
    const stage = workflow('cd-production.yml').jobs['stage-append'];
    assert.equal(stage.with.mode, 'append');
    assert.equal(stage.with['release-notes-artifact'], undefined);
    const text = stage.with['release-notes-text'];
    for (const part of [
      'inputs.action',
      'inputs.platforms',
      'inputs.play_rollout_percent',
      'github.run_id',
    ]) {
      assert.ok(text.includes(part), `the stage note leaves out ${part}`);
    }
    assert.equal(stage.if, '${{ !failure() && !cancelled() }}');
  });

  test('the hotfix baseline is publish-ota latest, and the smoke check reads the baseline fingerprint', () => {
    const publish = workflow('cd-ota-hotfix.yml').jobs.publish;
    assert.deepEqual(Object.keys(workflow('cd-ota-hotfix.yml').jobs), ['publish']);
    assert.equal(publish.needs, undefined);
    assert.equal(publish.with['baseline-tag'], "${{ inputs.baseline_tag || 'latest' }}");
    assert.equal(publish.with['runtime-version'], undefined);
    assert.equal(publish.with['manifest-url'], '${{ vars.EXPO_UPDATES_URL }}');
  });
});
