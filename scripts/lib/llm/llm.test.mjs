import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as anthropic from './anthropic.mjs';
import { ADAPTERS, adapterFor, EFFORTS, KEY_ENV, parseEffort, parseExtraParams } from './index.mjs';
import * as openai from './openai.mjs';

const respond =
  (payload, ok = true, status = 200) =>
  async (url, init) => {
    respond.last = { url, init, body: JSON.parse(init.body) };
    return { ok, status, json: async () => payload };
  };

/** Runs `fn` with the given environment variables set (undefined deletes one), then restores them. */
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const TEXT = {
  stop_reason: 'end_turn',
  content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: 'ok' },
  ],
};

test('anthropic: effort asks for adaptive thinking at that effort', async () => {
  const text = await anthropic.complete({
    system: 's',
    user: 'u',
    effort: 'max',
    fetchImpl: respond(TEXT),
  });
  assert.equal(text, 'ok');
  const { body } = respond.last;
  assert.deepEqual(body.thinking, { type: 'adaptive' });
  assert.deepEqual(body.output_config, { effort: 'max' });
});

test('anthropic: without an effort the request carries neither field', async () => {
  await anthropic.complete({ system: 's', user: 'u', fetchImpl: respond(TEXT) });
  assert.equal(respond.last.body.thinking, undefined);
  assert.equal(respond.last.body.output_config, undefined);
});

test('anthropic: extra parameters are merged into the body', async () => {
  await anthropic.complete({
    system: 's',
    user: 'u',
    extraParams: { metadata: { user_id: 'ci' } },
    fetchImpl: respond(TEXT),
  });
  assert.deepEqual(respond.last.body.metadata, { user_id: 'ci' });
});

test('anthropic: a refusal, an HTTP error and a missing text block all throw', async () => {
  await assert.rejects(
    anthropic.complete({
      system: 's',
      user: 'u',
      fetchImpl: respond({ stop_reason: 'refusal', content: [] }),
    }),
    /declined the request/,
  );
  await assert.rejects(
    anthropic.complete({ system: 's', user: 'u', fetchImpl: respond({}, false, 500) }),
    /HTTP 500/,
  );
  await assert.rejects(
    anthropic.complete({ system: 's', user: 'u', fetchImpl: respond({ content: [] }) }),
    /no text block/,
  );
});

const CHAT = { choices: [{ message: { content: '{"a":1}' } }] };

test('openai: the official endpoint gets max_completion_tokens, a compatible one max_tokens', async () => {
  await withEnv({ OPENAI_BASE_URL: undefined }, () =>
    openai.complete({ system: 's', user: 'u', maxTokens: 99, fetchImpl: respond(CHAT) }),
  );
  assert.equal(respond.last.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(respond.last.body.max_completion_tokens, 99);
  assert.equal(respond.last.body.max_tokens, undefined);

  await withEnv({ OPENAI_BASE_URL: 'https://api.moonshot.ai/v1' }, () =>
    openai.complete({ system: 's', user: 'u', maxTokens: 99, fetchImpl: respond(CHAT) }),
  );
  assert.equal(respond.last.url, 'https://api.moonshot.ai/v1/chat/completions');
  assert.equal(respond.last.body.max_tokens, 99);
  assert.equal(respond.last.body.max_completion_tokens, undefined);
});

test('openai: effort maps onto reasoning_effort, max to high', async () => {
  const sent = [];
  for (const effort of EFFORTS) {
    await openai.complete({ system: 's', user: 'u', effort, fetchImpl: respond(CHAT) });
    sent.push(respond.last.body.reasoning_effort);
  }
  assert.deepEqual(sent, ['low', 'medium', 'high', 'high']);
  await openai.complete({ system: 's', user: 'u', fetchImpl: respond(CHAT) });
  assert.equal(respond.last.body.reasoning_effort, undefined);
});

test('openai: extra parameters are merged, and failures throw', async () => {
  await openai.complete({
    system: 's',
    user: 'u',
    extraParams: { enable_thinking: true },
    fetchImpl: respond(CHAT),
  });
  assert.equal(respond.last.body.enable_thinking, true);
  await assert.rejects(
    openai.complete({ system: 's', user: 'u', fetchImpl: respond({}, false, 401) }),
    /HTTP 401/,
  );
  await assert.rejects(
    openai.complete({ system: 's', user: 'u', fetchImpl: respond({ choices: [] }) }),
    /no message content/,
  );
});

test('parseEffort defaults to max and refuses anything outside the vocabulary', () => {
  assert.equal(parseEffort(undefined, 'X'), 'max');
  assert.equal(parseEffort('', 'X'), 'max');
  assert.equal(parseEffort('low', 'X'), 'low');
  assert.throws(
    () => parseEffort('xhigh', 'X'),
    /X: expected one of low, medium, high, max, got "xhigh"/,
  );
});

test('parseExtraParams accepts an object, nested values included', () => {
  assert.deepEqual(parseExtraParams(undefined, 'X'), {});
  assert.deepEqual(parseExtraParams('', 'X'), {});
  assert.deepEqual(parseExtraParams('{"reasoning":{"effort":"high"},"top_k":5}', 'X'), {
    reasoning: { effort: 'high' },
    top_k: 5,
  });
});

test('parseExtraParams refuses what is not an object, and the fields that choose what is asked', () => {
  assert.throws(() => parseExtraParams('{oops', 'X'), /^Error: X: not valid JSON$/);
  assert.throws(() => parseExtraParams('[1]', 'X'), /expected a JSON object/);
  assert.throws(() => parseExtraParams('null', 'X'), /expected a JSON object/);
  assert.throws(() => parseExtraParams('"s"', 'X'), /expected a JSON object/);
  for (const key of ['model', 'messages', 'system']) {
    assert.throws(
      () => parseExtraParams(JSON.stringify({ [key]: 1 }), 'X'),
      new RegExp(`may not set ${key}`),
    );
  }
});

test('the value of a bad extra-parameters setting never reaches the error', () => {
  assert.throws(
    () => parseExtraParams('{"api_key": "sk-secret"', 'X'),
    (error) => !error.message.includes('sk-secret'),
  );
});

test('adapterFor knows the two providers and nothing else', () => {
  assert.equal(adapterFor('anthropic'), ADAPTERS.anthropic);
  assert.equal(adapterFor('openai'), ADAPTERS.openai);
  assert.equal(adapterFor(''), null);
  assert.equal(adapterFor('toString'), null);
  assert.deepEqual(KEY_ENV, { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' });
});
