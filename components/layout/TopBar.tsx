'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import AccountMenu from './AccountMenu';

// Primary navigation — moved here from the (now removed) left sidebar.
const NAV = [
  { label: 'Document Parser', href: '/documents/parser' },
  { label: 'Clause Library',  href: '/documents?tab=clause-table' },
  { label: 'Documents',       href: '/documents' },
];

function NavLinks() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab');

  function isActive(href: string): boolean {
    const [path, query] = href.split('?');
    if (path === '/documents' && pathname === '/documents') {
      const wantTab = query ? new URLSearchParams(query).get('tab') : null;
      return (wantTab || null) === (currentTab || null);
    }
    if (pathname !== path && !pathname.startsWith(path + '/')) return false;
    return true;
  }

  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {NAV.map(item => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              textDecoration: 'none',
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: '0.8rem',
              fontWeight: active ? 600 : 400,
              color: active ? 'var(--primary-accent)' : 'var(--text-secondary)',
              background: active ? 'rgba(124,58,237,0.1)' : 'transparent',
              whiteSpace: 'nowrap',
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function TopBar() {
  return (
    <header
      className="flex items-center justify-between px-6 border-b flex-shrink-0"
      style={{
        height: 'var(--nav-height)',
        background: 'rgba(4,4,8,0.92)',
        backdropFilter: 'blur(20px)',
        borderColor: 'var(--border-color)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        {/* Logo: Clause Library */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{
            display: 'inline-block',
            width: '0.85rem',
            height: '0.85rem',
            borderRadius: '50%',
            background: 'var(--primary-accent)',
            flexShrink: 0,
            animation: 'logoPulse 3s ease-in-out infinite',
            boxShadow: '0 0 12px rgba(124,58,237,0.55), 0 0 4px rgba(124,58,237,0.8)',
          }} />
          <span style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.01em', color: '#fff', lineHeight: 1 }}>
            Clause Library
          </span>
        </div>

        <Suspense fallback={<div style={{ width: 320 }} />}>
          <NavLinks />
        </Suspense>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <AccountMenu />
      </div>
    </header>
  );
}
