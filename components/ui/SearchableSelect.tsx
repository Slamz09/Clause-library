'use client';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export function SearchableSelect({
  value,
  onChange,
  options,
  style,
  placeholder = 'Select…',
  footerItems,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; group?: string }[];
  style?: React.CSSProperties;
  placeholder?: string;
  footerItems?: { label: string; onClick: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    if (!open) { setQuery(''); return; }
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!triggerRef.current?.contains(e.target as Node) && !dropRef.current?.contains(e.target as Node))
        setOpen(false);
    };
    // Only close on scroll if the scroll originates outside the dropdown panel
    const onScroll = (e: Event) => {
      if (dropRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const q = query.toLowerCase();
  const filtered = q
    ? options.filter(o => o.label.toLowerCase().includes(q) || (o.group ?? '').toLowerCase().includes(q))
    : options;

  const groupOrder: string[] = [];
  const groupMap = new Map<string, { value: string; label: string }[]>();
  for (const o of filtered) {
    const g = o.group ?? '';
    if (!groupMap.has(g)) { groupMap.set(g, []); groupOrder.push(g); }
    groupMap.get(g)!.push(o);
  }

  const selectedLabel = options.find(o => o.value === value)?.label ?? value ?? '';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, cursor: 'pointer', textAlign: 'left', overflow: 'hidden', ...style }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{selectedLabel || placeholder}</span>
        <span style={{ fontSize: '0.55em', opacity: 0.4, flexShrink: 0 }}>▼</span>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropRef}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: Math.max(pos.width, 240),
            zIndex: 99999, background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
            display: 'flex', flexDirection: 'column', maxHeight: 320,
          }}
        >
          <div style={{ padding: '7px 8px 5px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter' && filtered.length > 0) { onChange(filtered[0].value); setOpen(false); }
              }}
              placeholder="Search…"
              style={{ width: '100%', padding: '5px 8px', borderRadius: 5, boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.13)', color: '#e2e8f0', fontSize: '0.78rem', outline: 'none', fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            {filtered.length === 0 && <div style={{ padding: '12px', color: 'rgba(148,163,184,0.5)', fontSize: '0.75rem' }}>No results</div>}
            {groupOrder.map(g => (
              <div key={g}>
                {g && <div style={{ padding: '5px 10px 2px', fontSize: '0.61rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(148,163,184,0.4)', userSelect: 'none', position: 'sticky', top: 0, background: '#0f0f1a' }}>{g}</div>}
                {groupMap.get(g)!.map(o => (
                  <div
                    key={o.value}
                    onMouseDown={e => { e.preventDefault(); onChange(o.value); setOpen(false); }}
                    style={{ padding: '5px 12px 5px 16px', fontSize: '0.77rem', cursor: 'pointer', color: o.value === value ? '#a78bfa' : '#cbd5e1', background: o.value === value ? 'rgba(124,58,237,0.12)' : 'transparent', lineHeight: 1.4 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = o.value === value ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.05)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = o.value === value ? 'rgba(124,58,237,0.12)' : 'transparent'; }}
                  >
                    {o.label}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {footerItems && footerItems.length > 0 && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
              {footerItems.map((fi, i) => (
                <div
                  key={i}
                  onMouseDown={e => { e.preventDefault(); fi.onClick(); setOpen(false); }}
                  style={{ padding: '7px 12px', fontSize: '0.77rem', cursor: 'pointer', color: '#94a3b8' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = '#e2e8f0'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#94a3b8'; }}
                >
                  {fi.label}
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
