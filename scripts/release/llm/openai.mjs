// OpenAI chat completions over plain fetch, for teams whose key is the one they
// already have. OPENAI_BASE_URL points at a compatible gateway when set.
export const DEFAULT_MODEL = 'gpt-5';
const MAX_TOKENS = 2048;

/** The assistant's text for one system+user turn. Throws on any API failure. */
export async function complete({ system, user, model, fetchImpl = globalThis.fetch }) {
  const base = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const response = await fetchImpl(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_completion_tokens: MAX_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!response.ok) throw new Error(`openai: HTTP ${response.status}`);
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('openai: no message content in response');
  return text;
}
