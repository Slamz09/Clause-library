'use client';
import React, { useState, useEffect, useRef } from 'react';

export interface CounterpartyOption {
  id: string;
  name: string;
  type: 'client' | 'vendor';
}

interface Props {
  /** Currently selected counterparty id — shows chip instead of input when set */
  selectedId?: string;
  options: CounterpartyOption[];
  onSelect: (id: string) => void;
  onClear: () => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

// Search-as-you-type over the combined client+service provider list — used
// as a table filter (compact, chip-when-selected) rather than a full add/create picker.
export function CounterpartySearchSelect({
  selectedId,
  options,
  onSelect,
  onClear,
  placeholder = 'Search client or service provider…',
  style,
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = selectedId ? options.find(o => o.id === selectedId) : undefined;

  const filtered = query.trim()
    ? options.filter(o =>
        o.name.toLowerCase().includes(query.toLowerCase()) ||
        o.id.toLowerCase().includes(query.toLowerCase())
      )
    : options.slice(0, 50);

  function pick(o: CounterpartyOption) {
    onSelect(o.id);
    setQuery('');
    setOpen(false);
  }

  const base: React.CSSProperties = {
    padding: '6px 10px',
    borderRadius: 6,
    background: '#0d0a1a',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--text-primary)',
    fontSize: '0.78rem',
    fontFamily: 'inherit',
    outline: 'none',
    colorScheme: 'dark',
    minWidth: 200,
    boxSizing: 'border-box',
    ...style,
  };

  if (selectedId) {
    return (
      <div style={{ ...base, display: 'flex', alignItems: 'center', gap: 8, color: '#a78bfa', borderColor: 'rgba(167,139,250,0.4)' }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected?.name || selectedId}
          <span style={{ marginLeft: 6, fontFamily: 'monospace', fontSize: '0.68rem', opacity: 0.7 }}>
            {selected ? `(${selected.type === 'vendor' ? 'Service Provider' : 'Client'})` : selectedId}
          </span>
        </span>
        <button
          type="button"
          onClick={onClear}
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: 0, flexShrink: 0 }}
        >×</button>
      </div>
    );
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        style={base}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, minWidth: 260, zIndex: 999,
          background: '#13101f', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 6, marginTop: 2, maxHeight: 240, overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {filtered.map(o => (
            <div
              key={`${o.type}-${o.id}`}
              onMouseDown={() => pick(o)}
              style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.18)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span style={{ fontSize: '0.82rem', color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.65rem', color: '#a78bfa', flexShrink: 0 }}>{o.type === 'vendor' ? 'SP' : 'CLI'} · {o.id}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
