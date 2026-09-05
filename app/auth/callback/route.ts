import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Allowlist of paths that redirectTo may resolve to after login.
// Prevents open redirect attacks where an attacker crafts a link that
// redirects the user to an external site after authentication.
const REDIRECT_ALLOWLIST = [
  '/documents/parser',
  '/legal-requirements',
  '/evaluations',
  '/decision-traces',
  '/evidence',
  '/operations',
  '/customers',
  '/contracts-documents',
  '/insurance',
  '/jurisdictions-policy',
  '/incidents-notices',
  '/sla-handoff',
  '/recording-consent',
  '/background-checks',
  '/admin-security',
  '/obligations',
  '/documents',
  '/reset-password',
]

const DEFAULT_REDIRECT = '/documents/parser'

function isSafeRedirect(redirectTo: string): boolean {
  try {
    // Must be a relative path (no host)
    if (redirectTo.startsWith('//') || /^https?:\/\//i.test(redirectTo)) {
      return false
    }
    const path = redirectTo.split('?')[0]
    return REDIRECT_ALLOWLIST.some(
      (allowed) => path === allowed || path.startsWith(allowed + '/')
    )
  } catch {
    return false
  }
}

// Handles the OAuth / magic-link redirect back from Supabase Auth.
// Exchanges the one-time code for a session cookie, then redirects to the app.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const rawRedirectTo = searchParams.get('redirectTo') ?? '';
  const redirectTo = isSafeRedirect(rawRedirectTo) ? rawRedirectTo : DEFAULT_REDIRECT;

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
  }

  // Code missing or exchange failed — back to login
  return NextResponse.redirect(`${origin}/login`);
}
