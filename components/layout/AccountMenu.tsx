'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/db/supabase-client';

export default function AccountMenu() {
  const [email, setEmail] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    // getUser() re-validates the token against Supabase Auth rather than
    // trusting the locally-stored session, so a tampered/expired cookie
    // can't be used to spoof a signed-in top bar.
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) {
        setEmail(data.user?.email ?? null);
        setChecked(true);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
      setChecked(true);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  function openMenu() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;

    function handlePointer(e: MouseEvent) {
      const target = e.target as Node;
      const insideMenu = menuRef.current?.contains(target);
      const insideButton = buttonRef.current?.contains(target);
      if (!insideMenu && !insideButton) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function handleReposition() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) setMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }

    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [open]);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    // 'global' scope revokes the refresh token server-side (not just the
    // local session), so a copied cookie can't keep the session alive.
    await supabase.auth.signOut({ scope: 'global' });
    setOpen(false);
    router.push('/login');
    router.refresh();
  }

  if (!checked) {
    return <div style={{ width: 32, height: 32 }} />;
  }

  if (!email) {
    return (
      <Link
        href="/login"
        className="text-sm font-medium text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-lg border"
        style={{ borderColor: 'var(--border-color)' }}
      >
        Sign in
      </Link>
    );
  }

  const initial = email.charAt(0).toUpperCase();

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'var(--primary-accent)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        {initial}
      </button>

      {open && mounted && menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed w-64 rounded-xl border shadow-lg overflow-hidden"
            style={{
              top: menuPos.top,
              right: menuPos.right,
              background: 'var(--bg-secondary)',
              borderColor: 'var(--border-color)',
              zIndex: 1000,
            }}
          >
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <p className="text-xs uppercase tracking-widest text-white/40">Signed in as</p>
              <p className="text-sm text-white/90 truncate mt-0.5">{email}</p>
            </div>

            <Link
              href="/account"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-white/80 hover:bg-white/5 transition-colors"
            >
              Account settings
            </Link>

            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
