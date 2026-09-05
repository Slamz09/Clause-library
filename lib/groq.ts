import Groq from 'groq-sdk';
import OpenAI from 'openai';

export const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export const GROQ_MODEL = 'openai/gpt-oss-120b';

// Mistral free API fallback — OpenAI-compatible endpoint.
// Configure via .env.local:
//   MISTRAL_API_KEY=your_key_here  (get one free at console.mistral.ai)
//   MISTRAL_MODEL=mistral-small-latest  (default)
const mistralClient = new OpenAI({
  baseURL: 'https://api.mistral.ai/v1',
  apiKey: process.env.MISTRAL_API_KEY || '',
});

export const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-small-latest';

function shouldFallbackToMistral(err: unknown): boolean {
  const e = err as any;
  if (e?.status === 429 || e?.statusCode === 429) return true;
  // Groq also returns 413 "Request too large" for tokens-per-minute limits —
  // functionally the same as a rate limit (this org's TPM cap is small), so
  // it should trigger the same Mistral fallback rather than propagate as fatal.
  const code = e?.error?.error?.code || e?.error?.code || e?.code;
  if (code === 'rate_limit_exceeded') return true;
  // A deprecated/inaccessible GROQ_MODEL (404 model_not_found) means Groq
  // can never succeed for this request no matter how many times it's
  // retried — same fallback as a rate limit applies, so a stale model
  // constant degrades to Mistral instead of failing extraction outright.
  // (2026-08-23: this exact failure took down extract-clauses-llama when
  // Groq deprecated llama-3.3-70b-versatile — see GROQ_MODEL above.)
  if (code === 'model_not_found') return true;
  return false;
}

/**
 * Drop-in replacement for groqClient.chat.completions.create().
 *
 * Priority:
 *   1. Groq (when GROQ_API_KEY is set and not rate-limited)
 *   2. Mistral free API (when MISTRAL_API_KEY is set)
 *
 * Falls back to Mistral automatically on 429 or when GROQ_API_KEY is absent.
 */
export async function createChatCompletion(
  params: Parameters<typeof groqClient.chat.completions.create>[0],
): Promise<any> {
  if (process.env.GROQ_API_KEY) {
    try {
      return await groqClient.chat.completions.create(params) as any;
    } catch (err) {
      if (!shouldFallbackToMistral(err)) throw err;
      console.warn('[LLM] Groq request failed (rate limit or unavailable model) — falling back to Mistral');
    }
  } else {
    console.info('[LLM] No GROQ_API_KEY set — using Mistral');
  }

  if (!process.env.MISTRAL_API_KEY) {
    throw new Error('[LLM] No fallback available: set MISTRAL_API_KEY in .env.local');
  }

  // Mistral fallback: same params, override model, force non-streaming
  return await mistralClient.chat.completions.create({
    ...(params as any),
    model: MISTRAL_MODEL,
    stream: false,
  }) as any;
}
