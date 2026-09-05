/**
 * Server-side data client.
 *
 * This standalone build does NOT talk to the parent project's shared Supabase
 * database. Every `createServerClient()` here returns a local, file-backed
 * stand-in (see lib/localDb.ts) that persists to `.data/` on disk. Delete the
 * `.data/` directory to start fresh.
 *
 * The return type is still declared as `SupabaseClient` so the many call
 * sites and helper signatures that expect one keep type-checking unchanged —
 * the local shim implements the subset of that surface the clause/parser
 * pipeline actually uses.
 *
 * Auth is unaffected — it still runs against Supabase via
 * lib/db/supabase-server.ts (`createSessionClient`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient as createLocalClient } from './localDb';

export function createServerClient(): SupabaseClient {
  return createLocalClient() as unknown as SupabaseClient;
}
