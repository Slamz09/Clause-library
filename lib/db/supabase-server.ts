import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Session-scoped server client for API route handlers and server components.
 * Uses the user's session cookie — does NOT bypass RLS.
 * All queries run as the authenticated user; RLS filters rows automatically.
 *
 * Call once per request. Do not store across requests.
 */
export async function createSessionClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Route Handler context — cookies become read-only after headers are sent.
            // Suppressed intentionally; session refresh is best-effort server-side.
          }
        },
      },
    }
  )
}
