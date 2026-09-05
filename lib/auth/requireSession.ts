import { NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/db/supabase-server';

/**
 * Auth gate — DISABLED for this standalone build.
 *
 * The parent platform gated every API route on a Supabase session. This
 * extracted single-user tool has no multi-tenant concern and no user
 * directory to authenticate against, so requireSession() is a no-op: every
 * route runs unauthenticated. Restore the body below (the original
 * getUser()-based check) if this ever needs real auth again.
 */
export async function requireSession(): Promise<NextResponse | null> {
  return null;
}

/**
 * Authenticated caller's id/email, or null. With the gate disabled this is
 * best-effort: it still tries to read a Supabase session if one happens to
 * exist, but callers must already handle null (nothing depends on it today).
 */
export async function getSessionUser(): Promise<{ id: string; email: string | undefined } | null> {
  try {
    const supabase = await createSessionClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return { id: user.id, email: user.email };
  } catch {
    return null;
  }
}
