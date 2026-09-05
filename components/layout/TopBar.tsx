'use client';

import AccountMenu from './AccountMenu';

interface TopBarProps {
  onUploadClick?: () => void;
}

export default function TopBar({ onUploadClick }: TopBarProps) {

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
      {/* Logo: CONS●LA */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        <span style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.01em', color: '#fff', lineHeight: 1 }}>
          CONS
        </span>
        <span style={{
          display: 'inline-block',
          width: '1.05rem',
          height: '1.05rem',
          borderRadius: '50%',
          background: 'var(--primary-accent)',
          flexShrink: 0,
          animation: 'logoPulse 3s ease-in-out infinite',
          boxShadow: '0 0 12px rgba(124,58,237,0.55), 0 0 4px rgba(124,58,237,0.8)',
          margin: '0 2px',
          verticalAlign: 'middle',
          position: 'relative',
          top: 0,
        }} />
        <span style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.01em', color: '#fff', lineHeight: 1 }}>
          LA
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <AccountMenu />
      </div>
    </header>
  );
}
