// Anthropic Messages API over plain fetch. No SDK on purpose: this repo ships
// zero runtime dependencies for its release scripts, and the request is one
// POST. https://docs.anthropic.com/en/api/messages
export const DEFAULT_MODEL = 'claude-sonnet-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MAX_TOKENS = 2048;

/** The assistant's text for one system+user turn. Throws on any API failure. */
export async function complete({ system, user, model, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!response.ok) throw new Error(`anthropic: HTTP ${response.status}`);
  const payload = await response.json();
  const text = payload?.content?.find?.((block) => block?.type === 'text')?.text;
  if (typeof text !== 'string') throw new Error('anthropic: no text block in response');
  return text;
}
