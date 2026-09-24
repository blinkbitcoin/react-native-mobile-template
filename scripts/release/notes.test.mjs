import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as anthropic from './llm/anthropic.mjs';
import {
  maxTokensFor,
  renderPrompt,
  rewriteNotes,
  TESTFLIGHT_LIMIT,
  validate,
} from './llm/index.mjs';
import * as openai from './llm/openai.mjs';
import {
  buildNotes,
  cleanSection,
  cleanText,
  commitSubjects,
  discoverLocales,
  extractStoreSection,
  limitText,
  loadPrompt,
  main,
  parseArgs,
  parseBody,
  parseCommits,
  renderChangelog,
  renderNotes,
  resolveLocales,
  STORE_LIMITS,
  TRUNCATION_SUFFIX,
  toStoreNotes,
  USAGE,
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

test('a verbatim section is final: the changelog is never appended to it', async () => {
  const items = parseBody(body);
  const notes = await buildNotes({
    items,
    locales: ['en-US'],
    verbatim: 'Reviewed prose.',
    includeChangelog: true,
  });
  assert.equal(notes['en-US'], 'Reviewed prose.');
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
        prompt: 'Write for {{locales}} within {{limit}} characters.',
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
        rewriteNotes({ items: [], prompt: 'p', locales: ['en-US'], provider: 'anthropic' }),
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
          rewriteNotes({ items: [], prompt: 'p', locales, provider: 'anthropic' }),
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
      rewriteNotes({ items: [], prompt: 'p', locales: ['en-US'], provider: 'anthropic' }),
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
        rewriteNotes({ items: [], prompt: 'p', locales: ['en-US'], provider: 'openai' }),
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
    () => rewriteNotes({ items: [], prompt: 'p', locales: ['en-US'], provider: 'none' }),
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

// ---------- fix round 1: hygiene of a hand-written override ----------

test('a hand-written "## Store notes" override is cleaned, not trusted', () => {
  const section = [
    '## Store notes',
    '',
    'See the [full notes](https://example.com/notes) and PR #128 (9f2c1ab) **bold**.',
    '',
    '- Faster launch [ios]',
    '* ENG-42: fewer crashes',
  ].join('\n');
  const cleaned = cleanSection(extractStoreSection(section));
  assert.equal(
    cleaned,
    ['See the full notes and PR bold.', '', '• Faster launch ios', '• fewer crashes'].join('\n'),
  );
  assert.doesNotMatch(cleaned, /[#[\]*`<>]|https?:/);
});

// ---------- store notes on the release PR: markers and rules ----------

test('a section appended by the shared workflow ends at its end marker', () => {
  // The exact shape cd-beta leaves behind: the shared append mode wraps
  // the section in HTML-comment markers, and production reads it back.
  const body = [
    '## [0.6.1](https://example.com/compare/v0.6.0...v0.6.1) (2026-09-21)',
    '',
    '### Bug Fixes',
    '',
    '* fix one',
    '',
    '<!-- workflows:append:Store notes -->',
    '## Store notes',
    '',
    'Fixed',
    '• Close the alerts.',
    '<!-- /workflows:append:Store notes -->',
  ].join('\n');
  const cleaned = cleanSection(extractStoreSection(body));
  assert.equal(cleaned, 'Fixed\n• Close the alerts.');
  assert.doesNotMatch(cleaned, /!--/);
});

test('a section inside a release PR body ends at the footer rule', () => {
  const body = [
    ':robot: I have created a release *beep* *boop*',
    '---',
    '',
    '## [0.6.1](https://example.com/compare/v0.6.0...v0.6.1) (2026-09-21)',
    '',
    '<!-- workflows:append:Store notes -->',
    '## Store notes',
    '',
    'Fixed',
    '• Close the alerts.',
    '<!-- /workflows:append:Store notes -->',
    '',
    '---',
    'This PR was generated with Release Please.',
  ].join('\n');
  assert.equal(cleanSection(extractStoreSection(body)), 'Fixed\n• Close the alerts.');
});

test('a comment line inside a section is dropped, not shipped', () => {
  const body = ['## Store notes', '', 'New', '<!-- a note to self -->', '• Thing.'].join('\n');
  assert.equal(cleanSection(extractStoreSection(body)), 'New\n• Thing.');
});

test('a rewrite carrying a rule line or html is rejected', () => {
  const cases = [
    ['Fixed\n---\nMore', /contains a horizontal rule/],
    ['<details>hidden</details>', /contains html/],
    ['Fixed <!-- x --> things', /contains html/],
  ];
  for (const [text, expected] of cases) {
    const result = validate(JSON.stringify({ 'en-US': text }), ['en-US']);
    assert.equal(result.notes, undefined, text);
    assert.match(result.error, expected);
  }
});

test('the cli sends --body-section through the same filter', () => {
  const dir = tempDir();
  const file = path.join(dir, 'body.md');
  writeFileSync(
    file,
    [
      '### Features',
      '',
      '* **x:** thing',
      '',
      '## Store notes',
      '',
      'Read [more](https://x.dev/a) about PR #7 (9f2c1ab).',
    ].join('\n'),
  );
  const notes = JSON.parse(
    execFileSync(process.execPath, [script, '--from-body', file, '--body-section', '--out', '-'], {
      encoding: 'utf8',
      env: { ...process.env, RELEASE_NOTES_LLM_PROVIDER: '' },
    }),
  );
  assert.equal(notes['en-US'].testflight, 'Read more about PR.');
});

test('bracket tags, html and ticket keys never survive cleanText', () => {
  assert.equal(cleanText('fix: crash on launch [ios]'), 'Fix: crash on launch ios.');
  assert.equal(parseCommits(['fix: crash on launch [ios]'])[0].text, 'Crash on launch ios.');
  assert.equal(parseCommits(['feat: new tab bar [WIP] <b>x</b>'])[0].text, 'New tab bar WIP x.');
  // A tag broken open by another tag: the tag strip runs to a fixpoint, and
  // the bracket strip takes apart whatever is left, so no `<` or `>` ever
  // reaches a store.
  assert.equal(parseCommits(['feat: x <scr<b>ipt>alert(1)</script>'])[0].text, 'X iptalert(1).');
  assert.equal(parseCommits(['fix: JIRA-123 handle retry'])[0].text, 'Handle retry.');
});

test('a revert keeps the reverted change, not its header', () => {
  assert.deepEqual(parseCommits(['revert: feat(x): dark mode'])[0], {
    group: 'Other',
    text: 'Reverted dark mode.',
  });
});

test('a [user-visible] marker moves a body bullet out of Other', () => {
  const items = parseBody(
    ['### Miscellaneous Chores', '', '* **theme:** use the system font [user-visible]'].join('\n'),
  );
  assert.deepEqual(items, [{ group: 'Improved', text: 'Use the system font.' }]);
});

// ---------- fix round 1: llm validation ----------

test('links, bare domains with a path and markdown are rejected', () => {
  const cases = [
    ['Visit https://example.com/promo for details.', /contains a link/],
    ['Now at example.com/promo.', /contains a domain/],
    ['* markdown bullet\n- another', /contains markdown/],
    ['Now with **bold**.', /contains markdown/],
  ];
  for (const [text, expected] of cases) {
    const result = validate(JSON.stringify({ 'en-US': text }), ['en-US']);
    assert.equal(result.notes, undefined, text);
    assert.match(result.error, expected);
  }
  // A sentence that merely names a product is not a link.
  assert.equal(
    validate('{"en-US": "Faster on iOS 26."}', ['en-US']).notes['en-US'],
    'Faster on iOS 26.',
  );
});

test('the output budget grows with the number of locales', () => {
  assert.equal(maxTokensFor(['en-US']), 2524);
  assert.equal(maxTokensFor(['en-US', 'sv-SE', 'de-DE']), 5524);
  assert.equal(maxTokensFor(new Array(20).fill('x')), 8192);
});

// ---------- the prompt template at the repo root ----------

test('the prompt template is rendered with the locales and the limit', () => {
  const rendered = renderPrompt('Locales: {{locales}}. At most {{limit}} characters.', {
    locales: 'en-US, sv-SE',
    limit: 4000,
  });
  assert.equal(rendered, 'Locales: en-US, sv-SE. At most 4000 characters.');
  assert.throws(
    () => renderPrompt('{{nope}}', { locales: 'en-US', limit: 1 }),
    /unknown placeholder/,
  );
});

test('the rendered template is the whole system prompt the adapter receives', async () => {
  const calls = [];
  await withEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' }, () =>
    withFetch(stubFetch(JSON.parse(fixture('anthropic-response.json')), calls), () =>
      rewriteNotes({
        items: [],
        prompt: 'Rules for {{locales}}, {{limit}} max.',
        locales: ['en-US', 'sv-SE'],
        provider: 'anthropic',
      }),
    ),
  );
  assert.equal(
    JSON.parse(calls[0].init.body).system,
    `Rules for en-US, sv-SE, ${TESTFLIGHT_LIMIT} max.`,
  );
});

test('a missing prompt template means no rewrite, with a warning', async () => {
  const calls = [];
  const warnings = [];
  const notes = await withEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' }, () =>
    withFetch(stubFetch({}, calls), () =>
      withWarnings(warnings, () =>
        rewriteNotes({ items: [], prompt: '', locales: ['en-US'], provider: 'anthropic' }),
      ),
    ),
  );
  assert.equal(notes, null);
  assert.equal(calls.length, 0);
  assert.match(warnings.join('\n'), /release-notes\.prompt\.md/);
});

test('the shipped prompt template renders and states the output contract', () => {
  const template = loadPrompt();
  assert.match(template, /\{\{locales\}\}/);
  const rendered = renderPrompt(template, { locales: 'en-US', limit: TESTFLIGHT_LIMIT });
  assert.match(rendered, /\{"en-US": "\.\.\."\}/);
  assert.match(rendered, new RegExp(`At most ${TESTFLIGHT_LIMIT} characters`));
  assert.doesNotMatch(rendered, /\{\{/);
});

test('the budget reaches the adapter as max_tokens', async () => {
  const calls = [];
  await withEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' }, () =>
    withFetch(stubFetch(JSON.parse(fixture('anthropic-response.json')), calls), () =>
      rewriteNotes({ items: [], prompt: 'p', locales: ['en-US', 'sv-SE'], provider: 'anthropic' }),
    ),
  );
  assert.equal(JSON.parse(calls[0].init.body).max_tokens, maxTokensFor(['en-US', 'sv-SE']));
});

// ---------- fix round 1: cli surface ----------

test('a flag without a value, and two sources at once, both fail loudly', () => {
  assert.throws(() => parseArgs(['--locales']), /--locales needs a value/);
  assert.throws(() => parseArgs(['--from-body', 'a.md', '--from-commits']), /mutually exclusive/);
  assert.throws(() => parseArgs([]), /is required/);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
  assert.deepEqual(parseArgs(['--from-commits', 'v1..HEAD']).range, 'v1..HEAD');
  assert.equal(parseArgs(['--from-commits']).range, '');
  assert.equal(parseArgs(['--from-commits', '--include-changelog']).includeChangelog, true);
});

test('locales come from the ios metadata directories, ignoring the non-locales', () => {
  const dir = tempDir();
  for (const name of ['en-US', 'fr-FR', 'review_information', 'screenshots']) {
    mkdirSync(path.join(dir, name));
  }
  assert.deepEqual(discoverLocales(dir), ['en-US', 'fr-FR']);
  assert.deepEqual(discoverLocales(path.join(dir, 'nope')), ['en-US']);
});

test('NOTES_LOCALES is honoured, below --locales and above discovery', () => {
  // build-prepare exports it for its `notes-locales` input; before this the
  // input was plumbed through the whole workflow and then ignored.
  const flag = { locales: ['sv-SE'] };
  const none = { locales: [] };
  assert.deepEqual(resolveLocales(flag, { NOTES_LOCALES: 'de,fr-FR' }), ['sv-SE']);
  assert.deepEqual(resolveLocales(none, { NOTES_LOCALES: 'de,fr-FR' }), ['de', 'fr-FR']);
  assert.deepEqual(resolveLocales(none, { NOTES_LOCALES: ' de , fr-FR ,' }), ['de', 'fr-FR']);
  // An empty or absent value must not produce an empty locale list, which would
  // write a store-notes.json with no locales in it at all.
  assert.deepEqual(resolveLocales(none, { NOTES_LOCALES: '' }), discoverLocales());
  assert.deepEqual(resolveLocales(none, {}), discoverLocales());
});

test('--help prints the usage and exits 0 without rendering anything', () => {
  const stdout = execFileSync('node', [script, '--help'], { encoding: 'utf8' });
  assert.match(stdout, /^usage: node scripts\/release\/notes\.mjs /);
  assert.match(stdout, /--from-commits/);
  assert.match(stdout, /--locales/);
});

test('commit subjects default to the range since the last v* tag', () => {
  const repo = tempDir();
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('commit', '--quiet', '--allow-empty', '-m', 'feat: one');
  // No tag yet: everything on HEAD is the release.
  assert.deepEqual(commitSubjects('', repo), ['feat: one']);
  git('tag', 'v1.0.0');
  git('commit', '--quiet', '--allow-empty', '-m', 'fix: two');
  assert.deepEqual(commitSubjects('', repo), ['fix: two']);
  assert.deepEqual(commitSubjects('v1.0.0..HEAD', repo), ['fix: two']);
});

test('STORE_NOTES_INCLUDE_CHANGELOG=true appends the changelog through the cli', () => {
  const notes = JSON.parse(
    execFileSync(
      process.execPath,
      [script, '--from-body', path.join(here, 'fixtures', 'release-body.md'), '--out', '-'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          RELEASE_NOTES_LLM_PROVIDER: '',
          STORE_NOTES_INCLUDE_CHANGELOG: 'true',
        },
      },
    ),
  );
  assert.match(notes['en-US'].testflight, /\nChangelog\nNew: Stay signed in/);
});

test('notes-store.txt falls back to the first locale when en-US is not requested', () => {
  const out = tempDir();
  execFileSync(
    process.execPath,
    [
      script,
      '--from-body',
      path.join(here, 'fixtures', 'release-body.md'),
      '--locales',
      'sv-SE',
      '--out',
      out,
    ],
    { encoding: 'utf8', env: { ...process.env, RELEASE_NOTES_LLM_PROVIDER: '' } },
  );
  const notes = JSON.parse(readFileSync(path.join(out, 'store-notes.json'), 'utf8'));
  assert.deepEqual(Object.keys(notes), ['sv-SE']);
  assert.equal(
    readFileSync(path.join(out, 'notes-store.txt'), 'utf8'),
    `${notes['sv-SE'].testflight}\n`,
  );
});

// ---------- main, in process ----------

/** Runs `main` with its output captured; returns the exit code and both streams. */
async function runMain(argv, io = {}) {
  const out = [];
  const err = [];
  const code = await main(argv, {
    env: { RELEASE_NOTES_LLM_PROVIDER: '' },
    write: (text) => out.push(text),
    error: (line) => err.push(line),
    ...io,
  });
  return { code, out: out.join(''), err };
}

const releaseBody = path.join(here, 'fixtures', 'release-body.md');

test('main prints the usage for -h and exits 0', async () => {
  const { code, out, err } = await runMain(['-h']);
  assert.equal(code, 0);
  assert.equal(out, `${USAGE}\n`);
  assert.deepEqual(err, []);
});

test('main resolves --from-body against cwd and writes both files into --out', async () => {
  const out = tempDir();
  const { code, err } = await runMain(
    ['--from-body', 'release-body.md', '--out', out, '--locales', 'en-US'],
    { cwd: path.join(here, 'fixtures') },
  );
  assert.equal(code, 0);
  assert.deepEqual(err, [`store notes written to ${out} (en-US)`]);
  const notes = JSON.parse(readFileSync(path.join(out, 'store-notes.json'), 'utf8'));
  assert.equal(
    readFileSync(path.join(out, 'notes-store.txt'), 'utf8'),
    `${notes['en-US'].testflight}\n`,
  );
});

test('main takes the locales from the environment it is given', async () => {
  const { code, out } = await runMain(['--from-body', releaseBody], {
    env: { NOTES_LOCALES: 'de,fr-FR' },
  });
  assert.equal(code, 0);
  assert.deepEqual(Object.keys(JSON.parse(out)), ['de', 'fr-FR']);
});

test('main renders an empty commit range from --from-commits', async () => {
  const { code, out } = await runMain(['--from-commits', 'HEAD..HEAD', '--locales', 'en-US']);
  assert.equal(code, 0);
  assert.equal(JSON.parse(out)['en-US'].testflight, renderNotes([]));
});

test('main hands the provider and model from its environment to the rewrite', async () => {
  const seen = [];
  const { code, out } = await runMain(['--from-body', releaseBody, '--locales', 'en-US'], {
    env: { RELEASE_NOTES_LLM_PROVIDER: 'openai', RELEASE_NOTES_LLM_MODEL: 'gpt-5-mini' },
    rewrite: async (request) => {
      seen.push(request);
      return { 'en-US': 'Rewritten.' };
    },
  });
  assert.equal(code, 0);
  assert.equal(seen[0].provider, 'openai');
  assert.equal(seen[0].model, 'gpt-5-mini');
  assert.equal(JSON.parse(out)['en-US'].play, 'Rewritten.');
});

test('a rewrite that cannot be trusted leaves the deterministic prose', async () => {
  const items = parseBody(body);
  const notes = await buildNotes({
    items,
    locales: ['en-US'],
    provider: 'anthropic',
    rewrite: async () => null,
  });
  assert.equal(notes['en-US'], renderNotes(items));
});

test('main reports a bad argument on stderr and exits 1', async () => {
  const { code, out, err } = await runMain(['--nope']);
  assert.equal(code, 1);
  assert.equal(out, '');
  assert.deepEqual(err, ['unknown argument: --nope']);
});

test('main reports a failure that is not an Error as itself', async () => {
  const { code, err } = await runMain(['--from-body', releaseBody, '--locales', 'en-US'], {
    env: { RELEASE_NOTES_LLM_PROVIDER: 'anthropic' },
    rewrite: async () => {
      throw 'provider exploded';
    },
  });
  assert.equal(code, 1);
  assert.deepEqual(err, ['provider exploded']);
});

test('the cli exits 1 with the reason on a bad argument', () => {
  const result = spawnSync(process.execPath, [script, '--nope'], {
    encoding: 'utf8',
    env: { ...process.env, RELEASE_NOTES_LLM_PROVIDER: '' },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, 'unknown argument: --nope\n');
});

// ---------- llm adapters: every failure shape ----------

test('the anthropic adapter sends an empty key rather than "undefined" and honours a model', async () => {
  const calls = [];
  await withEnv({ ANTHROPIC_API_KEY: '' }, () =>
    withFetch(stubFetch({ content: [{ type: 'text', text: 'ok' }] }, calls), () =>
      anthropic.complete({ system: 's', user: 'u', model: 'claude-haiku-5' }),
    ),
  );
  assert.equal(calls[0].init.headers['x-api-key'], '');
  assert.equal(JSON.parse(calls[0].init.body).model, 'claude-haiku-5');
});

test('the anthropic adapter throws on an HTTP failure', async () => {
  await assert.rejects(
    withFetch(stubFetch({}, [], false), () => anthropic.complete({ system: 's', user: 'u' })),
    /anthropic: HTTP 500/,
  );
});

test('the anthropic adapter throws when the response has no text block', async () => {
  for (const payload of [
    {},
    null,
    { content: 'not a list' },
    { content: [null, { type: 'tool_use' }] },
    { content: [{ type: 'text', text: 42 }] },
  ]) {
    await assert.rejects(
      withFetch(stubFetch(payload, []), () => anthropic.complete({ system: 's', user: 'u' })),
      /anthropic: no text block in response/,
      JSON.stringify(payload),
    );
  }
});

test('the openai adapter sends an empty bearer and the default model and endpoint', async () => {
  const calls = [];
  await withEnv({ OPENAI_API_KEY: '', OPENAI_BASE_URL: '' }, () =>
    withFetch(stubFetch({ choices: [{ message: { content: 'ok' } }] }, calls), () =>
      openai.complete({ system: 's', user: 'u', maxTokens: 10 }),
    ),
  );
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.authorization, 'Bearer ');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.model, 'gpt-5');
  assert.equal(sent.max_completion_tokens, 10);
});

test('the openai adapter throws when the response has no message content', async () => {
  for (const payload of [
    null,
    {},
    { choices: [] },
    { choices: [{}] },
    { choices: [{ message: {} }] },
  ]) {
    await assert.rejects(
      withFetch(stubFetch(payload, []), () => openai.complete({ system: 's', user: 'u' })),
      /openai: no message content in response/,
      JSON.stringify(payload),
    );
  }
});

// ---------- edge cases of the deterministic pipeline ----------

test('a line with nothing left after cleaning is dropped, not rendered empty', () => {
  assert.equal(cleanText(''), '');
  assert.equal(cleanText('Done!'), 'Done!');
  assert.deepEqual(parseBody('### Features\n\n* (#12)\n* real thing'), [
    { group: 'New', text: 'Real thing.' },
  ]);
  assert.deepEqual(parseCommits(['', '  ', 'fix: (#12)']), []);
});

test('a revert of a subject that is not conventional keeps the subject', () => {
  assert.deepEqual(parseCommits(['revert: something plain']), [
    { group: 'Other', text: 'Reverted something plain.' },
  ]);
});

test('no items means no changelog, and a missing prompt file is an empty prompt', () => {
  assert.equal(renderChangelog([]), '');
  assert.equal(loadPrompt(path.join(tempDir(), 'absent.prompt.md')), '');
});

test('locale discovery falls back to en-US when the metadata has no locale directory', () => {
  const dir = tempDir();
  mkdirSync(path.join(dir, 'review_information'));
  assert.deepEqual(discoverLocales(dir), ['en-US']);
  assert.deepEqual(discoverLocales(path.join(dir, 'absent')), ['en-US']);
});

test('an empty or over-long rewrite is rejected', () => {
  assert.deepEqual(validate(JSON.stringify({ 'en-US': '  ' }), ['en-US']), {
    error: 'en-US: empty',
  });
  assert.deepEqual(
    validate(JSON.stringify({ 'en-US': 'a'.repeat(TESTFLIGHT_LIMIT + 1) }), ['en-US']),
    { error: `en-US: longer than ${TESTFLIGHT_LIMIT} characters` },
  );
});
