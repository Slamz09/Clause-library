import Groq from 'groq-sdk';
import OpenAI from 'openai';

// Override with GROQ_MODEL in the environment. The default (openai/gpt-oss-120b)
// is best-quality but Groq's free tier caps it hard (8k tokens/min, 200k/day) —
// a single document's extract + classify + form-classify pipeline exhausts that
// and every call 429s. On the free tier set GROQ_MODEL=llama-3.1-8b-instant, or
// upgrade to Groq's Dev tier and keep the default.
export const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// Mistral free "Experiment" plan fallback (OpenAI-compatible endpoint). Its
// free limits are much higher than Groq's, so it's a good backstop when Groq
// rate-limits. Requires an ACTIVATED Mistral account — an un-activated one
// returns 429 with x-ratelimit-limit-req-minute: 0 on every request.
//   MISTRAL_API_KEY=...            (console.mistral.ai → API Keys)
//   MISTRAL_MODEL=mistral-small-latest   (default)
export const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-small-latest';

// Both clients are created lazily — the SDK constructors throw on a missing key,
// which at module load would crash anything importing this file at build time.
let _groq: Groq | null = null;
function groq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}
let _mistral: OpenAI | null = null;
function mistral(): OpenAI {
  if (!_mistral) _mistral = new OpenAI({ baseURL: 'https://api.mistral.ai/v1', apiKey: process.env.MISTRAL_API_KEY || '' });
  return _mistral;
}

function shouldFallbackToMistral(err: unknown): boolean {
  const e = err as any;
  if (e?.status === 429 || e?.statusCode === 429) return true;
  if (e?.status === 413 || e?.statusCode === 413) return true; // Groq TPM-limit shape
  const code = e?.error?.error?.code || e?.error?.code || e?.code;
  return code === 'rate_limit_exceeded' || code === 'model_not_found';
}

type ChatCreateParams = Parameters<Groq['chat']['completions']['create']>[0];

/**
 * Thin wrapper over the Groq chat-completions API, with automatic failover to
 * Mistral on a 429 / rate-limit / deprecated-model error (when MISTRAL_API_KEY
 * is set). If neither provider works the error propagates; callers that can
 * degrade without an LLM handle it — e.g. extract-clauses-llama falls back to
 * the deterministic rule-based segmenter.
 */
export async function createChatCompletion(params: ChatCreateParams): Promise<any> {
  if (process.env.GROQ_API_KEY) {
    try {
      return await groq().chat.completions.create(params) as any;
    } catch (err) {
      if (!shouldFallbackToMistral(err) || !process.env.MISTRAL_API_KEY) throw err;
      console.warn('[LLM] Groq rate-limited/unavailable — falling back to Mistral');
    }
  } else if (!process.env.MISTRAL_API_KEY) {
    throw new Error('[LLM] Neither GROQ_API_KEY nor MISTRAL_API_KEY is set');
  }

  return await mistral().chat.completions.create({
    ...(params as any),
    model: MISTRAL_MODEL,
    stream: false,
  }) as any;
}
