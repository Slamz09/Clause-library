import Groq from 'groq-sdk';

export const GROQ_MODEL = 'openai/gpt-oss-120b';

type ChatCreateParams = Parameters<Groq['chat']['completions']['create']>[0];

// Instantiated lazily. The groq-sdk constructor throws when GROQ_API_KEY is
// missing/empty; doing that at module load would crash anything that imports
// this file at build time (`next build`'s page-data collection evaluates every
// route module). Deferring it to the first call means a missing key surfaces
// as a clean runtime error on the LLM route instead of a broken build.
let _client: Groq | null = null;
function groq(): Groq {
  if (!_client) _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _client;
}

/**
 * Thin wrapper over the Groq chat-completions API.
 *
 * Groq is the only LLM provider — the former Mistral fallback has been removed
 * (the account had no API entitlement, so every call just added latency before
 * failing). On a Groq error the exception propagates; callers that can degrade
 * without an LLM handle it themselves — e.g. app/api/documents/
 * extract-clauses-llama falls back to the deterministic rule-based segmenter.
 */
export async function createChatCompletion(params: ChatCreateParams): Promise<any> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('[LLM] GROQ_API_KEY is not set');
  }
  return await groq().chat.completions.create(params) as any;
}
