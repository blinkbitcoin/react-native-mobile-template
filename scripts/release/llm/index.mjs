// Optional LLM rewrite of the deterministic store notes.
//
// The contract with the caller is one-way: this returns `{locale: text}` only
// when the model's answer passes every check, and `null` otherwise. Every
// failure -- no key, HTTP error, unparseable JSON, a missing locale, a leaked
// commit hash -- is a warning on stderr and a fall back to the deterministic
// prose. A release must never fail because a model was unavailable.
import * as anthropic from './anthropic.mjs';
import * as openai from './openai.mjs';

const PROVIDERS = { anthropic, openai };
const KEY_ENV = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' };
/** The tightest limit the text must fit before per-store cuts are applied. */
const TESTFLIGHT_LIMIT = 4000;

const JSON_INSTRUCTIONS = `
## Output format

Reply with a single JSON object and nothing else. No markdown, no code fence,
no commentary. One key per requested locale, each value the complete release
notes for that locale as plain text:

{"en-US": "..."}

Hard rules for every value:
- Plain text only. No markdown, no headings, no links, no "#" characters.
- No commit hashes, no PR or issue numbers, no ticket keys, no scopes.
- At most ${TESTFLIGHT_LIMIT} characters.
- Never invent a change that is not in the input.
`.trim();

/** The user turn: the deterministic items, grouped, plus the locales wanted. */
function buildUserPrompt(items, locales) {
  const lines = items.map((item) => `- [${item.group}] ${item.text}`);
  return [
    'Changes in this release:',
    lines.length ? lines.join('\n') : '(no user-facing changes)',
    '',
    `Locales: ${locales.join(', ')}`,
  ].join('\n');
}

/** Reasons `text` cannot be shipped to a store, in the order they are checked. */
function violations(text) {
  const found = [];
  if (!text.trim()) found.push('empty');
  if (text.includes('#')) found.push('contains "#"');
  if (text.includes('[')) found.push('contains markdown link syntax');
  if (/\b(?=[0-9a-f]{7,40}\b)[0-9a-f]*\d[0-9a-f]*\b/i.test(text)) found.push('contains a hash');
  if (text.length > TESTFLIGHT_LIMIT) found.push(`longer than ${TESTFLIGHT_LIMIT} characters`);
  return found;
}

/** `{locale: text}` when every requested locale validates, otherwise null. */
export function validate(raw, locales) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'response is not JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'response is not a JSON object' };
  }
  const notes = {};
  for (const locale of locales) {
    const value = parsed[locale];
    if (typeof value !== 'string') return { error: `missing locale ${locale}` };
    const problems = violations(value);
    if (problems.length) return { error: `${locale}: ${problems.join(', ')}` };
    notes[locale] = value.trim();
  }
  return { notes };
}

/**
 * Rewritten notes per locale, or null when the rewrite cannot be trusted.
 * `provider` is `anthropic`, `openai`, or anything else (meaning: don't).
 */
export async function rewriteNotes({ items, context, locales, provider, model, fetchImpl }) {
  const adapter = PROVIDERS[provider];
  if (!adapter) return null;

  if (!process.env[KEY_ENV[provider]]) {
    console.warn(`release notes: ${KEY_ENV[provider]} is not set, keeping the generated notes`);
    return null;
  }

  const system = [context?.trim(), JSON_INSTRUCTIONS].filter(Boolean).join('\n\n');
  let raw;
  try {
    raw = await adapter.complete({
      system,
      user: buildUserPrompt(items, locales),
      model,
      fetchImpl,
    });
  } catch (error) {
    console.warn(
      `release notes: ${provider} rewrite failed (${error.message}), keeping the generated notes`,
    );
    return null;
  }

  const result = validate(raw, locales);
  if (result.error) {
    console.warn(
      `release notes: ${provider} rewrite rejected (${result.error}), keeping the generated notes`,
    );
    return null;
  }
  return result.notes;
}
