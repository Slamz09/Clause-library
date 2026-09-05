'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/db/supabase-client';

const MIN_PASSWORD_LENGTH = 8;

function LoginForm() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  // Set once a password check succeeds but the account has a verified 2FA
  // factor — the session is aal1 until the code below is verified, and
  // nothing here or server-side treats it as fully signed in until then.
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaChallengeId, setMfaChallengeId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState('');
  const [mfaVerifying, setMfaVerifying] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();

  function switchMode(next: 'signin' | 'signup') {
    setMode(next);
    setError('');
    setNotice('');
    setPassword('');
    setConfirmPassword('');
  }

  function completeSignIn() {
    const redirectTo = searchParams.get('redirectTo') || '/documents/parser';
    router.push(redirectTo);
    router.refresh();
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      // Return a generic message — never leak specific auth errors (user enumeration)
      setError('Invalid email or password.');
      setLoading(false);
      return;
    }

    // Check whether this account has 2FA enrolled and still needs to step up.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const factor = factors?.totp?.[0];
      if (!factor) {
        setError('Two-factor verification is required but no method was found. Contact support.');
        setLoading(false);
        return;
      }
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: factor.id,
      });
      if (challengeError || !challenge) {
        setError('Could not start two-factor verification. Please try again.');
        setLoading(false);
        return;
      }
      setMfaFactorId(factor.id);
      setMfaChallengeId(challenge.id);
      setLoading(false);
      return;
    }

    setLoading(false);
    completeSignIn();
  }

  async function handleVerifyMfa(e: React.FormEvent) {
    e.preventDefault();
    setMfaError('');

    if (!/^\d{6}$/.test(mfaCode)) {
      setMfaError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    if (!mfaFactorId || !mfaChallengeId) {
      setMfaError('Verification expired. Please sign in again.');
      return;
    }

    setMfaVerifying(true);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: mfaChallengeId,
      code: mfaCode,
    });
    setMfaVerifying(false);

    if (verifyError) {
      setMfaError('Invalid code. Please try again.');
      return;
    }

    completeSignIn();
  }

  async function handleCancelMfa() {
    // Abandon the aal1 session rather than leaving it sitting around unused.
    const supabase = createClient();
    await supabase.auth.signOut();
    setMfaFactorId(null);
    setMfaChallengeId(null);
    setMfaCode('');
    setMfaError('');
    setPassword('');
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);

    if (signUpError) {
      // Generic message — avoid confirming whether an account already exists
      setError('Unable to create account. Please check your details and try again.');
      return;
    }

    // Never leak whether the email was new or already registered
    setNotice('Check your email to confirm your account before signing in.');
    setPassword('');
    setConfirmPassword('');
  }

  if (mfaFactorId) {
    return (
      <form onSubmit={handleVerifyMfa} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="mfa-code" className="block text-xs font-medium text-white/50 uppercase tracking-widest">
            Authentication code
          </label>
          <input
            id="mfa-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
            className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/15 text-white text-sm tracking-[0.3em] text-center placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-white/30 focus:border-white/40 transition-colors"
            placeholder="000000"
            autoFocus
          />
          <p className="text-[11px] text-white/30">Enter the 6-digit code from your authenticator app.</p>
        </div>

        {mfaError && (
          <p className="text-red-400 text-sm" role="alert">
            {mfaError}
          </p>
        )}

        <button
          type="submit"
          disabled={mfaVerifying}
          className="w-full py-2 px-4 rounded-lg bg-white text-black text-sm font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {mfaVerifying ? 'Verifying…' : 'Verify'}
        </button>

        <button
          type="button"
          onClick={handleCancelMfa}
          className="w-full text-center text-sm text-white/40 hover:text-white/70 transition-colors"
        >
          Back to sign in
        </button>
      </form>
    );
  }

  if (mode === 'signup') {
    return (
      <div className="space-y-4">
        <form onSubmit={handleSignUp} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="signup-email" className="block text-xs font-medium text-white/50 uppercase tracking-widest">
              Email
            </label>
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/15 text-white text-sm placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-white/30 focus:border-white/40 transition-colors"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="signup-password" className="block text-xs font-medium text-white/50 uppercase tracking-widest">
              Password
            </label>
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/15 text-white text-sm placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-white/30 focus:border-white/40 transition-colors"
              placeholder="••••••••"
            />
            <p className="text-[11px] text-white/30">At least {MIN_PASSWORD_LENGTH} characters.</p>
          </div>

          <div className="space-y-1">
            <label htmlFor="signup-confirm-password" className="block text-xs font-medium text-white/50 uppercase tracking-widest">
              Confirm password
            </label>
            <input
              id="signup-confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/15 text-white text-sm placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-white/30 focus:border-white/40 transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="text-emerald-400 text-sm" role="status">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 rounded-lg bg-white text-black text-sm font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-white/40">
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className="text-white/70 hover:text-white underline underline-offset-2"
          >
            Sign in
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSignIn} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="email" className="block text-xs font-medium text-white/50 uppercase tracking-widest">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/15 text-white text-sm placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-white/30 focus:border-white/40 transition-colors"
            placeholder="you@example.com"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="block text-xs font-medium text-white/50 uppercase tracking-widest">
              Password
            </label>
            <Link href="/forgot-password" className="text-xs text-white/40 hover:text-white/70 transition-colors">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/15 text-white text-sm placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-white/30 focus:border-white/40 transition-colors"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <p className="text-red-400 text-sm" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 px-4 rounded-lg bg-white text-black text-sm font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-center text-sm text-white/40">
        Don&apos;t have an account?{' '}
        <button
          type="button"
          onClick={() => switchMode('signup')}
          className="text-white/70 hover:text-white underline underline-offset-2"
        >
          Create one
        </button>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f]">
      <div className="w-full max-w-sm space-y-8 px-8 py-10 rounded-2xl border border-white/10 bg-white/[0.03]">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Consola360</h1>
          <p className="mt-1 text-sm text-white/40">Sign in to continue</p>
        </div>
        {/* Suspense required by Next.js 14 for useSearchParams in client components */}
        <Suspense fallback={<div className="h-48" />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
