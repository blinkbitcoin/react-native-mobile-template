import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as anthropic from './llm/anthropic.mjs';
import { rewriteNotes } from './llm/index.mjs';
import * as openai from './llm/openai.mjs';
import {
  buildNotes,
  extractStoreSection,
  limitText,
  parseBody,
  parseCommits,
  renderChangelog,
  renderNotes,
  STORE_LIMITS,
  TRUNCATION_SUFFIX,
  toStoreNotes,
} from './notes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'notes.mjs');
const fixture = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');
const body = fixture('release-body.md');
const dirs = [];

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'store-notes-'));
  dirs.push(dir);
  return dir;
}

/** Runs `fn` with `globalThis.fetch` replaced, and restores it afterwards. */
async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

/** Runs `fn` with the given env vars set (empty string = unset), then restores. */
async function withEnv(vars, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === '') delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** A fetch that answers once with `payload`, recording the call it received. */
function stubFetch(payload, calls, ok = true) {
  return async (url, init) => {
    calls.push({ url, init });
    return { ok, status: ok ? 200 : 500, json: async () => payload };
  };
}

// ---------- deterministic renderer ----------

test('a release-please body renders as grouped, store-safe prose', () => {
  const notes = renderNotes(parseBody(body));
  assert.equal(
    notes,
    [
      'New',
      '• Stay signed in after a cold start.',
      '• Pull to refresh on the activity list.',
      '',
      'Improved',
      '• Cut the cold start time by roughly a third.',
      '',
      'Fixed',
      '• Keep drafts when the network drops mid-save.',
    ].join('\n'),
  );
  // Nothing from the repository survives into the notes.
  assert.doesNotMatch(notes, /[#[\]()*`]|https?:|auth:|9f2c1ab/);
  // A chore is real work, but not news for a store page.
  assert.doesNotMatch(notes, /expo/i);
});

test('conventional commit subjects group the same way', () => {
  const items = parseCommits([
    'feat(home): show the unread count on the tab bar (#12)',
    'fix: stop the crash when a push arrives while locked',
    'perf(list): render long lists without dropping frames',
    'refactor(api): split the client into modules',
    'refactor(theme): use the system font everywhere [user-visible]',
    'chore(deps): bump react-native',
    'not a conventional subject',
  ]);
  assert.deepEqual(
    items.map((item) => [item.group, item.text]),
    [
      ['New', 'Show the unread count on the tab bar.'],
      ['Fixed', 'Stop the crash when a push arrives while locked.'],
      ['Improved', 'Render long lists without dropping frames.'],
      ['Other', 'Split the client into modules.'],
      ['Improved', 'Use the system font everywhere.'],
      ['Other', 'Bump react-native.'],
    ],
  );
});

test('an empty release still says something honest, per locale', async () => {
  assert.equal(renderNotes([]), 'Bug fixes and improvements.');
  const notes = await buildNotes({ items: [], locales: ['en-US', 'sv-SE'] });
  assert.deepEqual(notes, {
    'en-US': 'Bug fixes and improvements.',
    'sv-SE': 'Bug fixes and improvements.',
  });
});

// ---------- truncation ----------

test('text at the limit is untouched, and one character over is cut to fit', () => {
  const exact = 'a'.repeat(500);
  assert.equal(limitText(exact, 500), exact);

  const over = `${'word '.repeat(120)}tail`.trim();
  const cut = limitText(over, 500);
  assert.equal(cut.length <= 500, true);
  assert.equal(cut.endsWith(TRUNCATION_SUFFIX), true);
  // A word boundary is honoured, so the cut never lands mid-word.
  assert.equal(cut.slice(0, -TRUNCATION_SUFFIX.length).endsWith('word'), true);
});

test('a limit too small for the pointer hard-cuts instead of returning only a suffix', () => {
  assert.equal(limitText('hello world', 5), 'hello');
  assert.equal(
    limitText('hello world again friend', TRUNCATION_SUFFIX.length),
    'hello world again',
  );
  assert.equal(limitText('hello world', 0), '');
});

test('a single long word keeps the window rather than losing nearly all of it', () => {
  const text = `x ${'y'.repeat(600)}`;
  const cut = limitText(text, 500);
  assert.equal(cut.length, 500);
  assert.equal(cut.startsWith('x yyy'), true);
});

test('every store field is produced within its own limit', () => {
  const long = 'Something changed and here is a sentence about it. '.repeat(200);
  const notes = toStoreNotes({ 'en-US': long });
  assert.equal(notes['en-US'].play.length <= STORE_LIMITS.play, true);
  assert.equal(notes['en-US'].appstore.length <= STORE_LIMITS.appstore, true);
  assert.equal(notes['en-US'].testflight.length <= STORE_LIMITS.testflight, true);
  assert.equal(notes['en-US'].play.endsWith(TRUNCATION_SUFFIX), true);
});

// ---------- body section + changelog ----------

test('a "## Store notes" section is used verbatim when asked for', async () => {
  const section = extractStoreSection(body);
  assert.match(section, /^Signing in sticks now/);
  const notes = await buildNotes({ items: parseBody(body), locales: ['en-US'], verbatim: section });
  assert.equal(notes['en-US'], section);
  assert.equal(extractStoreSection('### Features\n\n* something'), '');
});

test('--include-changelog appends the full grouped list, chores included', async () => {
  const items = parseBody(body);
  const changelog = renderChangelog(items);
  assert.match(changelog, /^Changelog\n/);
  assert.match(changelog, /Other: Bump expo to 57\.0\.20\./);

  const notes = await buildNotes({ items, locales: ['en-US'], includeChangelog: true });
  assert.equal(notes['en-US'], `${renderNotes(items)}\n\n${changelog}`);
});

// ---------- llm adapters ----------

test('the anthropic adapter posts the documented Messages API request', async () => {
  const calls = [];
  const text = await withEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' }, () =>
    withFetch(stubFetch(JSON.parse(fixture('anthropic-response.json')), calls), () =>
      anthropic.complete({ system: 'be brief', user: 'the changes' }),
    ),
  );

  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-api-key'], 'sk-ant-test');
  assert.equal(init.headers['anthropic-version'], '2023-06-01');
  assert.equal(init.headers['content-type'], 'application/json');
  const sent = JSON.parse(init.body);
  assert.equal(sent.model, 'claude-sonnet-5');
  assert.equal(sent.system, 'be brief');
  assert.deepEqual(sent.messages, [{ role: 'user', content: 'the changes' }]);
  assert.equal(typeof sent.max_tokens, 'number');
  assert.match(text, /^{"en-US"/);
});

test('the openai adapter posts a json-object chat completion', async () => {
  const calls = [];
  const text = await withEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: '' }, () =>
    withFetch(stubFetch(JSON.parse(fixture('openai-response.json')), calls), () =>
      openai.complete({ system: 'be brief', user: 'the changes', model: 'gpt-5-mini' }),
    ),
  );

  const [{ url, init }] = calls;
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(init.headers.authorization, 'Bearer sk-test');
  const sent = JSON.parse(init.body);
  assert.equal(sent.model, 'gpt-5-mini');
  assert.deepEqual(sent.response_format, { type: 'json_object' });
  assert.deepEqual(sent.messages[0], { role: 'system', content: 'be brief' });
  assert.match(text, /^{"en-US"/);
});

test('OPENAI_BASE_URL redirects the adapter at a compatible gateway', async () => {
  const calls = [];
  await withEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: 'https://gateway.internal/v1' }, () =>
    withFetch(stubFetch(JSON.parse(fixture('openai-response.json')), calls), () =>
      openai.complete({ system: 's', user: 'u' }),
    ),
  );
  assert.equal(calls[0].url, 'https://gateway.internal/v1/chat/completions');
});

// ---------- llm rewrite: validation and fallback ----------

test('a valid rewrite replaces the deterministic prose', async () => {
  const notes = await withEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' }, () =>
    withFetch(stubFetch(JSON.parse(fixture('anthropic-response.json')), []), () =>
      rewriteNotes({
        items: parseBody(body),
        context: '# context',
        locales: ['en-US'],
        provider: 'anthropic',
      }),
    ),
  );
  assert.match(notes['en-US'], /^Signing in sticks now/);
});

test('a rewrite that is not strict JSON is rejected and falls back', async () => {
  const warnings = [];
  const notes = await withEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' }, () =>
    withFetch(stubFetch(JSON.parse(fixture('anthropic-invalid-response.json')), []), () =>
      withWarnings(warnings, () =>
        rewriteNotes({ items: [], context: '', locales: ['en-US'], provider: 'anthropic' }),
      ),
    ),
  );
  assert.equal(notes, null);
  assert.match(warnings.join('\n'), /not JSON/);
});

test('markdown, hashes and a missing locale each reject the whole rewrite', async () => {
  const cases = [
    ['{"en-US": "New\\n# Heading"}', /contains "#"/],
    ['{"en-US": "See [the notes](https://x)"}', /markdown link/],
    ['{"en-US": "Fixed the crash (9f2c1ab)"}', /hash/],
    ['{"en-US": "ok"}', /missing locale sv-SE/],
    ['["en-US"]', /not a JSON object/],
  ];
  for (const [payload, expected] of cases) {
    const warnings = [];
    const locales = expected.source.includes('sv-SE') ? ['en-US', 'sv-SE'] : ['en-US'];
    const notes = await withEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' }, () =>
      withFetch(stubFetch({ content: [{ type: 'text', text: payload }] }, []), () =>
        withWarnings(warnings, () =>
          rewriteNotes({ items: [], context: '', locales, provider: 'anthropic' }),
        ),
      ),
    );
    assert.equal(notes, null, payload);
    assert.match(warnings.join('\n'), expected);
  }
});

test('a missing api key warns and falls back instead of throwing', async () => {
  const warnings = [];
  const notes = await withEnv({ ANTHROPIC_API_KEY: '' }, () =>
    withWarnings(warnings, () =>
      rewriteNotes({ items: [], context: '', locales: ['en-US'], provider: 'anthropic' }),
    ),
  );
  assert.equal(notes, null);
  assert.match(warnings.join('\n'), /ANTHROPIC_API_KEY is not set/);
});

test('an http failure warns and falls back', async () => {
  const warnings = [];
  const notes = await withEnv({ OPENAI_API_KEY: 'sk-test' }, () =>
    withFetch(stubFetch({}, [], false), () =>
      withWarnings(warnings, () =>
        rewriteNotes({ items: [], context: '', locales: ['en-US'], provider: 'openai' }),
      ),
    ),
  );
  assert.equal(notes, null);
  assert.match(warnings.join('\n'), /HTTP 500/);
});

test('no provider means no network call at all', async () => {
  const notes = await withFetch(
    () => {
      throw new Error('fetch must not be called');
    },
    () => rewriteNotes({ items: [], context: '', locales: ['en-US'], provider: 'none' }),
  );
  assert.equal(notes, null);
});

/** Runs `fn` with console.warn captured into `sink`. */
async function withWarnings(sink, fn) {
  const original = console.warn;
  console.warn = (message) => sink.push(String(message));
  try {
    return await fn();
  } finally {
    console.warn = original;
  }
}

// ---------- cli ----------

test('the cli writes store-notes.json and notes-store.txt into --out', () => {
  const out = tempDir();
  execFileSync(
    process.execPath,
    [script, '--from-body', path.join(here, 'fixtures', 'release-body.md'), '--out', out],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        RELEASE_NOTES_LLM_PROVIDER: '',
        STORE_NOTES_INCLUDE_CHANGELOG: '',
      },
    },
  );

  const notes = JSON.parse(readFileSync(path.join(out, 'store-notes.json'), 'utf8'));
  assert.deepEqual(Object.keys(notes), ['en-US']);
  assert.deepEqual(Object.keys(notes['en-US']).sort(), ['appstore', 'play', 'testflight']);
  assert.match(notes['en-US'].testflight, /^New\n• Stay signed in after a cold start\./);
  assert.equal(
    readFileSync(path.join(out, 'notes-store.txt'), 'utf8'),
    `${notes['en-US'].testflight}\n`,
  );
});

test('the cli prints json to stdout with --out - and honours --body-section', () => {
  const stdout = execFileSync(
    process.execPath,
    [
      script,
      '--from-body',
      path.join(here, 'fixtures', 'release-body.md'),
      '--body-section',
      '--locales',
      'en-US,sv-SE',
      '--out',
      '-',
    ],
    { encoding: 'utf8', env: { ...process.env, RELEASE_NOTES_LLM_PROVIDER: '' } },
  );
  const notes = JSON.parse(stdout);
  assert.deepEqual(Object.keys(notes), ['en-US', 'sv-SE']);
  assert.match(notes['en-US'].play, /^Signing in sticks now/);
  assert.equal(notes['sv-SE'].appstore, notes['en-US'].appstore);
});
