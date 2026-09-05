import Groq from 'groq-sdk';

// Override with GROQ_MODEL in the environment. The default (openai/gpt-oss-120b)
// is best-quality but Groq's free tier caps it hard (8k tokens/min, 200k/day) —
// a single document's extract + classify + form-classify pipeline exhausts that
// and every call 429s, dropping the whole app to keyword fallbacks. On the free
// tier set GROQ_MODEL=llama-3.1-8b-instant (30k tpm, far higher daily); for
// best quality upgrade to Groq's Dev tier and keep the default.
export const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

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
