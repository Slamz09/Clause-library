import { NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/db/supabase-server';

/**
 * Minimal per-route auth gate: verifies the caller has a valid Supabase
 * session (validated against the Auth server), nothing more.
 *
 * Interim measure until the Phase-0 workspace/RBAC gate (requireApiContext)
 * has its backing schema in place — it needs a populated `profiles` table,
 * workspace_id columns on data tables, RLS policies, and an X-Workspace-Id
 * header from the frontend, none of which exist yet. Swap call sites to
 * requireApiContext once that migration lands.
 *
 * The middleware (proxy.ts) deliberately does NOT validate API sessions
 * against the Auth server — it only checks cookie presence — so each route
 * calling this is what makes API auth real. One GoTrue round trip per
 * request, owned here.
 *
 * Usage at the top of every route handler:
 *   const denied = await requireSession();
 *   if (denied) return denied;
 */
export async function requireSession(): Promise<NextResponse | null> {
  const supabase = await createSessionClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

/**
 * Returns the authenticated caller's id/email, or null if there isn't one.
 * Separate from requireSession() (which only denies-or-not) so the many
 * existing call sites are unaffected — call this only where the caller's
 * identity is actually needed (e.g. attributing an audit-log row). Repeats
 * the GoTrue round trip requireSession() already did; accepted as a minor
 * latency trade-off over changing requireSession()'s shared return contract.
 */
export async function getSessionUser(): Promise<{ id: string; email: string | undefined } | null> {
  const supabase = await createSessionClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { id: user.id, email: user.email };
}
