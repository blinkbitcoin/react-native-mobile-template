// The release path must run as far as it can without an App Store Connect or
// Play account.
//
// It did not. Every stage chained its GitHub release behind its store uploads —
// `github-prerelease` needed `publish-ios` and `publish-android`, and neither
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
import { readFileSync } from 'node:fs';
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
    storeJobs: ['publish-ios', 'publish-android'],
    releaseJobs: ['github-prerelease'],
  },
  'release-beta.yml': {
    storeJobs: ['promote-ios', 'promote-android'],
    releaseJobs: ['github-release'],
  },
  'release-production.yml': {
    storeJobs: ['ios-release', 'android-release', 'ios-phased', 'android-rollout', 'android-halt'],
    releaseJobs: ['github-release'],
  },
};

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
