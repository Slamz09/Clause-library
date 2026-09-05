/**
 * Server-only environment validation.
 *
 * Import this module only from API route handlers, server components, and
 * other server-side lib/ utilities. It must never be imported from client
 * components — Next.js will exclude non-NEXT_PUBLIC_ vars from the client
 * bundle, but importing this file from the client would be a bug.
 *
 * This module throws at startup (import time) if any required variable is
 * absent or misconfigured, so misconfigured deployments fail immediately
 * rather than at first request.
 */

if (typeof window !== 'undefined') {
  throw new Error(
    'lib/env.ts was imported on the client. It must only be used in server-side code.'
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        `Check .env.example for documentation and set it in .env.local (dev) or your deployment environment (prod).`
    );
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

// ---------------------------------------------------------------------------
// APP_BASE_URL — required in production, where it must be HTTPS. Optional in
// dev (defaults to localhost).
// ---------------------------------------------------------------------------
const appBaseUrl =
  process.env.NODE_ENV === 'production'
    ? requireEnv('APP_BASE_URL')
    : optionalEnv('APP_BASE_URL') ?? 'http://localhost:3000';
if (process.env.NODE_ENV === 'production' && !appBaseUrl.startsWith('https://')) {
  throw new Error(
    `APP_BASE_URL must use HTTPS in production. Got: "${appBaseUrl}"\n` +
      'Update the APP_BASE_URL environment variable to your https:// deployment URL.'
  );
}

// ---------------------------------------------------------------------------
// Exported env — all values validated at startup
// ---------------------------------------------------------------------------
export const env = {
  NODE_ENV: (process.env.NODE_ENV ?? 'development') as 'development' | 'production' | 'test',

  APP_BASE_URL: appBaseUrl,

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),

  // LLM
  GROQ_API_KEY: requireEnv('GROQ_API_KEY'),
  MISTRAL_API_KEY: requireEnv('MISTRAL_API_KEY'),
  LLAMA_CLOUD_API_KEY: optionalEnv('LLAMA_CLOUD_API_KEY'),

  // Rate limiting (Upstash Redis) — optional until rate limiting is wired
  // into the AI/extraction routes (implementation-plan.md Phase 2); flip
  // back to requireEnv() in the same change that adds the limiter.
  UPSTASH_REDIS_REST_URL: optionalEnv('UPSTASH_REDIS_REST_URL'),
  UPSTASH_REDIS_REST_TOKEN: optionalEnv('UPSTASH_REDIS_REST_TOKEN'),

  // Seed / internal tools — optional until a seed route exists (deferred,
  // see implementation-plan.md).
  SEED_SECRET: optionalEnv('SEED_SECRET'),

  // Optional: Anthropic Claude
  ANTHROPIC_API_KEY: optionalEnv('ANTHROPIC_API_KEY'),
} as const;
