// What the CD callers still decide. The job graphs - which store jobs run
// behind which toggle, what survives a skipped upload, how Huawei waits on
// Android, what the security gate holds back, which rollout action moves which
// store - are shared-workflows' publish-internal.yml, publish-beta.yml,
// publish-production.yml and publish-store-listing.yml, and are tested there
// (test/pipelines.test.mjs). A caller is the trigger, the concurrency group,
// the permissions, the secrets and the inputs it passes, so this file holds
// those, plus the release chain around them (cd-release.yml, the retry
// listener, the beta gate and the push filter).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Top-level jobs of a workflow: name -> { if, needs, uses, with } as raw text. */
function parseJobs(file) {
  const lines = readFileSync(path.join(root, '.github/workflows', file), 'utf8').split('\n');
  const start = lines.indexOf('jobs:');
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
});

// The beta gate must heal itself: when the release commit's internal run is
// missing or red it dispatches one at the tag, which needs actions: write on
// the calling job. Without both, a release merged at the wrong moment waits
// for a human - which is what happened on v0.2.3, v0.2.4 and v0.2.5. The
// gate itself is publish-beta.yml's `prepare`; the caller names the workflow
// and grants the permission.
describe('the beta gate dispatches the build it is missing', () => {
  const beta = parse(readFileSync(path.join(root, '.github/workflows/cd-beta.yml'), 'utf8'));
  const internal = parse(
    readFileSync(path.join(root, '.github/workflows/cd-internal.yml'), 'utf8'),
  );

  test('beta names the internal workflow as the one that must be green, at the release tag', () => {
    assert.equal(beta.jobs.beta.with['green-workflow'], 'cd-internal.yml');
    assert.equal(beta.jobs.beta.with.tag, '${{ inputs.tag }}');
  });

  test('beta grants actions: write, which the dispatch needs, and contents: write for the release', () => {
    assert.equal(beta.jobs.beta.permissions.actions, 'write');
    assert.equal(beta.jobs.beta.permissions.contents, 'write');
  });

  test('the internal release grants contents: write, for the build tag it reserves at push time', () => {
    // GitHub refuses GITHUB_TOKEN a new tag on a commit whose workflow files
    // differ from main's tip; an hour after the push that is often the case.
    assert.equal(internal.jobs.internal.permissions.contents, 'write');
    assert.equal(internal.jobs.internal.permissions.actions, 'read');
    assert.equal(internal.jobs.internal.with['green-workflow'], 'ci.yml');
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

// The security gate has two callers. Each tier turns on what exists there -
// source on every change, the release's built binaries at the production
// dispatch - and the production store jobs cannot start until it has passed.
// Both halves are easy to break invisibly: a `needs:` that loses `security`
// ships an unchecked release, and a condition that uses the implicit
// success() makes every dispatch with the gate switched off skip its stores.
describe('the security gate', () => {
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

// Every CD workflow is one call to a shared pipeline (or, for the hotfix, to
// publish-ota.yml): no step, no shell, no job graph of its own.
describe('the CD callers are thin', () => {
  const dir = path.join(root, '.github/workflows');
  const callers = {
    'cd-internal.yml': 'publish-internal.yml',
    'cd-beta.yml': 'publish-beta.yml',
    'cd-production.yml': 'publish-production.yml',
    'cd-store-listing.yml': 'publish-store-listing.yml',
    'cd-ota-hotfix.yml': 'publish-ota.yml',
  };
  const wf = (file) => parse(readFileSync(path.join(dir, file), 'utf8'));
  const only = (file) => {
    const jobs = Object.entries(wf(file).jobs);
    assert.equal(jobs.length, 1, `${file} has ${jobs.length} jobs`);
    return jobs[0][1];
  };

  for (const [file, shared] of Object.entries(callers)) {
    test(`${file} is a single call to ${shared} at the pin`, () => {
      const job = only(file);
      assert.match(
        job.uses,
        new RegExp(
          `/shared-workflows/\\.github/workflows/${shared.replace('.', '\\.')}@[0-9a-f]{40}\\b`,
        ),
      );
      assert.equal(job.steps, undefined);
      assert.equal(job.needs, undefined);
    });
  }

  test('each CD file is one of those, or one of the release chain around them', () => {
    const files = readdirSync(dir)
      .filter((f) => /^cd-.*\.yml$/.test(f))
      .sort();
    assert.deepEqual(
      files,
      [...Object.keys(callers), 'cd-beta-retry.yml', 'cd-release.yml'].sort(),
    );
  });

  test('every secret the callers pass is a secret the shared workflow declares optional', () => {
    // Passing none is allowed, so a repository without a store account still runs.
    for (const file of Object.keys(callers)) {
      const secrets = only(file).secrets ?? {};
      for (const [name, value] of Object.entries(secrets)) {
        assert.equal(value, `\${{ secrets.${name} }}`, `${file}: ${name}`);
      }
    }
  });

  test('every toggle is read from a repository variable, so a checkout with none builds and publishes', () => {
    const internal = only('cd-internal.yml').with;
    assert.equal(internal['store-uploads-enabled'], "${{ vars.STORE_UPLOADS_ENABLED == 'true' }}");
    assert.equal(
      internal['huawei-uploads-enabled'],
      "${{ vars.HUAWEI_UPLOADS_ENABLED == 'true' }}",
    );
    assert.equal(internal['ota-enabled'], "${{ vars.OTA_ENABLED == 'true' }}");
    for (const file of ['cd-beta.yml', 'cd-production.yml']) {
      assert.equal(
        only(file).with['store-uploads-enabled'],
        "${{ vars.STORE_UPLOADS_ENABLED == 'true' }}",
        file,
      );
    }
    assert.equal(
      only('cd-store-listing.yml').with['store-metadata-sync-enabled'],
      "${{ vars.STORE_METADATA_SYNC_ENABLED == 'true' }}",
    );
  });

  test('build-number-offset is a number, whatever the repository variable holds', () => {
    for (const file of ['cd-internal.yml', 'cd-beta.yml', 'cd-production.yml']) {
      assert.equal(
        only(file).with['build-number-offset'],
        "${{ fromJSON(vars.BUILD_NUMBER_OFFSET || '1000') }}",
        file,
      );
    }
  });

  test('the production dispatch values go to the pipeline as inputs', () => {
    const with_ = only('cd-production.yml').with;
    assert.equal(with_.tag, '${{ inputs.tag }}');
    assert.equal(with_.action, '${{ inputs.action }}');
    assert.equal(with_.platforms, '${{ inputs.platforms }}');
    assert.equal(with_['play-rollout-percent'], '${{ inputs.play_rollout_percent }}');
    assert.equal(with_['ios-phased-release'], '${{ inputs.ios_phased_release }}');
  });

  test('the production caller grants what the pipeline asks for, and no more of the Pages scopes than the web input needs', () => {
    const production = only('cd-production.yml');
    assert.deepEqual(
      {
        contents: production.permissions.contents,
        actions: production.permissions.actions,
        events: production.permissions['security-events'],
      },
      { contents: 'write', actions: 'read', events: 'write' },
    );
    // Both Pages scopes and the web input are marked together, so `make init
    // --no-web` removes them as one: all three are there, or none is.
    const web = [
      production.permissions.pages,
      production.permissions['id-token'],
      production.with.web,
    ];
    assert.ok(
      web.every((value) => value !== undefined) || web.every((value) => value === undefined),
      `the Pages scopes and the web input must come and go together: ${web}`,
    );
    if (production.with.web !== undefined) {
      assert.deepEqual(web, ['write', 'write', true]);
    }
  });

  test('the security gate is switched off only by the SECURITY_ENABLED variable, and runs no LLM here', () => {
    assert.equal(
      only('cd-production.yml').with['security-enabled'],
      "${{ vars.SECURITY_ENABLED != 'false' }}",
    );
    assert.doesNotMatch(
      readFileSync(path.join(dir, 'cd-production.yml'), 'utf8')
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('#'))
        .join('\n'),
      /SECURITY_LLM|OPENAI_API_KEY|ANTHROPIC_API_KEY/,
    );
  });

  test('the hotfix baseline is the dispatch value or latest, behind the OTA toggle', () => {
    const hotfix = only('cd-ota-hotfix.yml');
    assert.equal(hotfix.with['baseline-tag'], "${{ inputs.baseline_tag || 'latest' }}");
    assert.equal(hotfix.if, "${{ vars.OTA_ENABLED == 'true' }}");
  });
});
