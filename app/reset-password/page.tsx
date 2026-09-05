'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/db/supabase-client';

const MIN_PASSWORD_LENGTH = 8;

export default function ResetPasswordPage() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setCheckingSession(false);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

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
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError('Could not update your password. Please request a new reset link.');
      setLoading(false);
      return;
    }

    // Force a fresh sign-in with the new password rather than leaving the
    // recovery session active.
    await supabase.auth.signOut();
    setDone(true);
    setLoading(false);
    setTimeout(() => router.push('/login'), 2000);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f]">
      <div className="w-full max-w-sm space-y-8 px-8 py-10 rounded-2xl border border-white/10 bg-white/[0.03]">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Set a new password</h1>
        </div>

        {checkingSession ? (
          <div className="h-32" />
        ) : done ? (
          <p className="text-sm text-emerald-400" role="status">
            Password updated. Redirecting to sign in…
          </p>
        ) : !hasSession ? (
          <div className="space-y-4">
            <p className="text-sm text-white/50" role="alert">
              This reset link is invalid or has expired.
            </p>
            <Link
              href="/forgot-password"
              className="block w-full text-center py-2 px-4 rounded-lg bg-white text-black text-sm font-medium hover:bg-white/90 transition-colors"
            >
              Request a new link
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="new-password" className="block text-xs font-medium text-white/50 uppercase tracking-widest">
                New password
              </label>
              <input
                id="new-password"
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
              <label htmlFor="confirm-new-password" className="block text-xs font-medium text-white/50 uppercase tracking-widest">
                Confirm new password
              </label>
              <input
                id="confirm-new-password"
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

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 rounded-lg bg-white text-black text-sm font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
