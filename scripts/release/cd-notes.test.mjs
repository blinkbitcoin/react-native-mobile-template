// The store notes as CD drafts them, run through the real code end to end:
// cd-release.yml's build-env, shared-workflows' build-env.sh, pr-notes.sh and
// notes.sh, and this repository's own notes.mjs with its prompt. Only two
// things are stood in for: `gh` (a shim serving a real release-please PR body
// and recording the edit) and the model (a local OpenAI-compatible endpoint).
//
// Unit tests prove each half on its own; this proves they still fit - that the
// variables cd-release.yml sends survive build-env's validation, that the
// flags notes.sh passes are the ones notes.mjs reads, and that the section
// pr-notes.sh writes is the one build-prepare reads back from the release.
//
// The shared scripts come from $WORKFLOWS_DIR, the checkout this run's
// workflows were called at, as in shared-copies.test.mjs: locally the cases
// skip unless it is set, and in CI a missing one fails.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../..', import.meta.url));
const PR_BODY = path.join(root, 'scripts', 'release', 'fixtures', 'release-pr-body.md');
const BEGIN = '<!-- workflows:append:Store notes -->';
const PROSE =
  'You can now keep the security gate on your own machine, and a blank laptop is ready for Android and iOS in one step.';

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** The shared-workflows scripts directory, or why the cases cannot run. */
function sharedScripts() {
  const dir = process.env.WORKFLOWS_DIR;
  if (!dir) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      throw new Error(
        'WORKFLOWS_DIR is not set in CI - the setup action exports it; without it the CD notes chain was NOT run',
      );
    }
    return {
      skip: 'WORKFLOWS_DIR not set: the CD notes chain was NOT run (set it to a shared-workflows checkout to run it)',
    };
  }
  const scripts = path.resolve(dir, 'scripts');
  if (!existsSync(path.join(scripts, 'release', 'pr-notes.sh'))) {
    throw new Error(`no shared release scripts under ${scripts}`);
  }
  return { scripts };
}

/**
 * cd-release.yml's store-notes build-env with the repository variables filled
 * in, evaluated the way GitHub does for the two expression shapes it uses. Any
 * other expression fails: this test must be told how to evaluate it.
 */
function evaluate(template, vars) {
  return template.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, expression) => {
    let match = /^toJSON\(vars\.(\w+) \|\| ''\)$/.exec(expression);
    if (match) return JSON.stringify(vars[match[1]] || '');
    match = /^vars\.(\w+)$/.exec(expression);
    if (match) return vars[match[1]] ?? '';
    throw new Error(`cd-notes.test.mjs cannot evaluate \${{ ${expression} }}`);
  });
}

function renderBuildEnv(vars) {
  const workflow = parse(readFileSync(path.join(root, '.github/workflows/cd-release.yml'), 'utf8'));
  return evaluate(workflow.jobs['store-notes'].with['build-env'], vars);
}

/** `$GITHUB_ENV` as a map: both the `KEY=value` and the `KEY<<DELIMITER` forms. */
function readGithubEnv(file) {
  const env = {};
  if (!existsSync(file)) return env;
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const heredoc = /^([A-Za-z_]\w*)<<(.+)$/.exec(lines[i]);
    if (heredoc) {
      const end = lines.indexOf(heredoc[2], i + 1);
      env[heredoc[1]] = lines.slice(i + 1, end).join('\n');
      i = end;
      continue;
    }
    const plain = /^([A-Za-z_]\w*)=(.*)$/.exec(lines[i]);
    if (plain) env[plain[1]] = plain[2];
  }
  return env;
}

/** Runs a shell script without blocking this process, so the stub endpoint can answer. */
function run(script, args, env) {
  return new Promise((resolve) => {
    const child = spawn('bash', [script, ...args], { cwd: root, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** A local OpenAI-compatible endpoint that answers every request with `reply`. */
async function stubModel(reply) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({ url: request.url, body: JSON.parse(body) });
      const { status, content } = reply;
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** A `gh` that serves `body` for `pr view` and records `pr edit`. */
function ghShim(dir) {
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  const shim = path.join(bin, 'gh');
  writeFileSync(
    shim,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'printf "%s\\n" "$*" >> "$GH_SHIM_LOG"',
      'case "$1 $2" in',
      '  "pr view") cat "$GH_SHIM_BODY" ;;',
      '  "pr edit") while [ $# -gt 0 ]; do [ "$1" = --body-file ] && cp "$2" "$GH_SHIM_EDITED"; shift; done ;;',
      '  *) echo "gh shim: unexpected $*" >&2; exit 1 ;;',
      'esac',
      '',
    ].join('\n'),
  );
  chmodSync(shim, 0o755);
  return bin;
}

/**
 * The store-notes job, step by step: build-env from cd-release.yml's
 * expression and `vars`, then pr-notes.sh on the fixture release PR with the
 * published environment and `secrets`.
 */
async function draftIntoReleasePr(scripts, { vars = {}, secrets = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cd-notes-'));
  dirs.push(dir);
  const bin = ghShim(dir);
  const files = {
    githubEnv: path.join(dir, 'github-env'),
    log: path.join(dir, 'gh.log'),
    edited: path.join(dir, 'edited.md'),
  };
  // Nothing from the developer's shell: a key or provider exported there would
  // change what this test exercises.
  const base = {
    PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: dir,
    GITHUB_WORKSPACE: root,
    WORKING_DIRECTORY: '.',
    RUNNER_TEMP: dir,
    WORKFLOWS_OUT: path.join(dir, 'out'),
    GITHUB_ENV: files.githubEnv,
  };
  const published = await run(path.join(scripts, 'release', 'build-env.sh'), [], {
    ...base,
    WORKFLOWS_BUILD_ENV: renderBuildEnv(vars),
  });
  assert.equal(
    published.code,
    0,
    `build-env.sh refused cd-release.yml's build-env:\n${published.stderr}`,
  );

  const drafted = await run(path.join(scripts, 'release', 'pr-notes.sh'), ['67'], {
    ...base,
    ...readGithubEnv(files.githubEnv),
    GH_REPO: 'acme/app',
    GH_TOKEN: 'unused-by-the-shim',
    NOTES_LOCALES: 'en-US',
    GH_SHIM_BODY: PR_BODY,
    GH_SHIM_LOG: files.log,
    GH_SHIM_EDITED: files.edited,
    ...secrets,
  });
  return {
    ...drafted,
    dir,
    edited: existsSync(files.edited) ? readFileSync(files.edited, 'utf8') : null,
    ghCalls: existsSync(files.log) ? readFileSync(files.log, 'utf8').trim().split('\n') : [],
    release: path.join(dir, 'out', 'release-meta'),
  };
}

/** The Store notes section of a PR body, between its markers. */
function sectionOf(body) {
  const start = body.indexOf(BEGIN);
  const end = body.indexOf('<!-- /workflows:append:Store notes -->');
  return body.slice(start, end);
}

test('the build-env cd-release.yml sends is valid JSON for any value a variable may hold', () => {
  for (const extra of ['', '{"response_format": null}', '{"reasoning": {"effort": "low"}}']) {
    const parsed = JSON.parse(
      renderBuildEnv({
        RELEASE_NOTES_LLM_PROVIDER: 'openai',
        RELEASE_NOTES_LLM_EXTRA_PARAMS: extra,
      }),
    );
    assert.equal(parsed.RELEASE_NOTES_LLM_EXTRA_PARAMS, extra);
    assert.equal(parsed.RELEASE_NOTES_LLM_PROVIDER, 'openai');
  }
  // An expression this file does not know how to evaluate is a failure, not an
  // empty string that happens to parse.
  assert.throws(() => evaluate(`{"A":"\${{ github.sha }}"}`, {}), /cannot evaluate/);
});

/**
 * Whether a run left the release PR as it was: not edited at all, or edited to
 * the same body. Trailing blank lines do not count - shared-workflows up to
 * v0.13.0 drops them and so re-edits an unchanged PR on every run, which costs
 * an API call but changes nothing a person or release-please reads.
 */
function leftAsItWas(result) {
  if (result.edited === null) return true;
  const trim = (text) => text.replace(/\s+$/, '');
  return trim(result.edited) === trim(readFileSync(PR_BODY, 'utf8'));
}

test('with no provider the release PR keeps the generated notes it already has', async (t) => {
  const shared = sharedScripts();
  if (shared.skip) return t.skip(shared.skip);
  const result = await draftIntoReleasePr(shared.scripts);
  assert.equal(result.code, 0, result.stderr);
  // The fixture already carries the generated section, so a correct run
  // rebuilds exactly the same body.
  assert.equal(result.ghCalls[0], 'pr view 67 --repo acme/app --json body --jq .body');
  assert.ok(leftAsItWas(result), `the release PR body changed:\n${result.edited}`);
  assert.match(
    readFileSync(path.join(result.release, 'notes-store.txt'), 'utf8'),
    /^New\n• Add the local half of the security gate\./,
  );
});

test('a provider set through the repository variables rewrites the section, replacing the old one', async (t) => {
  const shared = sharedScripts();
  if (shared.skip) return t.skip(shared.skip);
  const model = await stubModel({ status: 200, content: JSON.stringify({ 'en-US': PROSE }) });
  try {
    const result = await draftIntoReleasePr(shared.scripts, {
      vars: {
        RELEASE_NOTES_LLM_PROVIDER: 'openai',
        RELEASE_NOTES_LLM_MODEL: 'any-model',
        RELEASE_NOTES_LLM_EFFORT: 'none',
        RELEASE_NOTES_LLM_EXTRA_PARAMS: '{"response_format": null}',
        OPENAI_BASE_URL: model.baseUrl,
      },
      secrets: { OPENAI_API_KEY: 'sk-test' },
    });
    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /release notes: /);
    assert.equal(model.requests.length, 1);
    const [{ url, body }] = model.requests;
    assert.equal(url, '/v1/chat/completions');
    assert.equal(body.model, 'any-model');
    assert.equal('reasoning_effort' in body, false);
    assert.equal('response_format' in body, false);
    assert.match(body.messages[1].content, /Add the release-time security scanners/);

    assert.ok(result.edited, 'the release PR was not edited');
    assert.equal(result.edited.split(BEGIN).length - 1, 1, 'the section was stacked, not replaced');
    assert.match(sectionOf(result.edited), new RegExp(PROSE));
    assert.doesNotMatch(sectionOf(result.edited), /• Add the local half/);
    assert.match(result.edited, /\n---\nThis PR was generated with \[Release Please\]/);
  } finally {
    await model.close();
  }
});

test('a model that fences its answer still rewrites the section', async (t) => {
  const shared = sharedScripts();
  if (shared.skip) return t.skip(shared.skip);
  const fenced = `\`\`\`json\n${JSON.stringify({ 'en-US': PROSE })}\n\`\`\``;
  const model = await stubModel({ status: 200, content: fenced });
  try {
    const result = await draftIntoReleasePr(shared.scripts, {
      vars: { RELEASE_NOTES_LLM_PROVIDER: 'openai', OPENAI_BASE_URL: model.baseUrl },
      secrets: { OPENAI_API_KEY: 'sk-test' },
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(sectionOf(result.edited), new RegExp(PROSE));
  } finally {
    await model.close();
  }
});

test('a model that fails leaves the generated notes and a warning, never a failed job', async (t) => {
  const shared = sharedScripts();
  if (shared.skip) return t.skip(shared.skip);
  const model = await stubModel({ status: 500, content: '' });
  try {
    const result = await draftIntoReleasePr(shared.scripts, {
      vars: { RELEASE_NOTES_LLM_PROVIDER: 'openai', OPENAI_BASE_URL: model.baseUrl },
      secrets: { OPENAI_API_KEY: 'sk-test' },
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /release notes: openai rewrite failed \(openai: HTTP 500\)/);
    assert.ok(leftAsItWas(result), `the release PR body changed:\n${result.edited}`);
  } finally {
    await model.close();
  }
});

test('the section written into the release PR is what the release lanes read back', async (t) => {
  const shared = sharedScripts();
  if (shared.skip) return t.skip(shared.skip);
  const model = await stubModel({ status: 200, content: JSON.stringify({ 'en-US': PROSE }) });
  let drafted;
  try {
    drafted = await draftIntoReleasePr(shared.scripts, {
      vars: { RELEASE_NOTES_LLM_PROVIDER: 'openai', OPENAI_BASE_URL: model.baseUrl },
      secrets: { OPENAI_API_KEY: 'sk-test' },
    });
  } finally {
    await model.close();
  }
  assert.ok(drafted.edited, 'the release PR was not edited');

  // release-please makes the GitHub release body from the text between the
  // first and the last `---` line of the merged PR body. Simulated here: this
  // is release-please's documented behaviour, not code this run can call.
  const lines = drafted.edited.split('\n');
  const first = lines.indexOf('---');
  const last = lines.lastIndexOf('---');
  const releaseBody = path.join(drafted.dir, 'release-body.md');
  writeFileSync(releaseBody, lines.slice(first + 1, last).join('\n'));

  // build-prepare with `release-tag`: notes.sh on the release body, with no
  // model settings at all - the CD lanes carry none.
  const out = path.join(drafted.dir, 'lanes');
  const read = await run(path.join(shared.scripts, 'release', 'notes.sh'), [], {
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: drafted.dir,
    GITHUB_WORKSPACE: root,
    WORKING_DIRECTORY: '.',
    RUNNER_TEMP: drafted.dir,
    WORKFLOWS_OUT: out,
    RELEASE_BODY_FILE: releaseBody,
    NOTES_LOCALES: 'en-US',
  });
  assert.equal(read.code, 0, read.stderr);
  assert.equal(
    readFileSync(path.join(out, 'release-meta', 'notes-store.txt'), 'utf8'),
    `${PROSE}\n`,
  );
});
