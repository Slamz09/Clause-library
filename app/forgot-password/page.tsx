'use client';
import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/db/supabase-client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const supabase = createClient();
    // Errors are intentionally ignored here — always show the same generic
    // confirmation regardless of outcome, so this endpoint can't be used to
    // enumerate which emails have accounts.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?redirectTo=/reset-password`,
    });

    setLoading(false);
    setSubmitted(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f]">
      <div className="w-full max-w-sm space-y-8 px-8 py-10 rounded-2xl border border-white/10 bg-white/[0.03]">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Reset password</h1>
          <p className="mt-1 text-sm text-white/40">
            {submitted
              ? 'Check your email for a reset link.'
              : "We'll email you a link to reset your password."}
          </p>
        </div>

        {submitted ? (
          <p className="text-sm text-white/50" role="status">
            If an account exists for <span className="text-white/70">{email}</span>, a password
            reset link has been sent. The link expires shortly, so use it soon.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
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

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 rounded-lg bg-white text-black text-sm font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-white/40">
          <Link href="/login" className="text-white/70 hover:text-white underline underline-offset-2">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
