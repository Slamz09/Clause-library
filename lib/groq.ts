import Groq from 'groq-sdk';

export const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export const GROQ_MODEL = 'openai/gpt-oss-120b';

/**
 * Thin wrapper over groqClient.chat.completions.create().
 *
 * Groq is the only LLM provider. The former Mistral fallback has been removed
 * (the account had no API entitlement — every call just added latency before
 * failing). On a Groq error the exception propagates; callers that can degrade
 * without an LLM handle it themselves — e.g. app/api/documents/
 * extract-clauses-llama falls back to the deterministic rule-based segmenter.
 */
export async function createChatCompletion(
  params: Parameters<typeof groqClient.chat.completions.create>[0],
): Promise<any> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('[LLM] GROQ_API_KEY is not set');
  }
  return await groqClient.chat.completions.create(params) as any;
}
