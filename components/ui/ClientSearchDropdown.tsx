'use client';
import React, { useState, useEffect, useRef } from 'react';
import { CLIENTS } from '@/lib/mockData';

interface ClientOption {
  client_id: string;
  client_name: string;
}

interface Props {
  /** Currently selected client id — shows chip instead of input when set */
  selectedId?: string;
  selectedName?: string;
  onSelect: (client_id: string, client_name: string) => void;
  onClear?: () => void;
  placeholder?: string;
  inputStyle?: React.CSSProperties;
}

export function ClientSearchDropdown({
  selectedId,
  selectedName,
  onSelect,
  onClear,
  placeholder = 'Search by client name…',
  inputStyle,
}: Props) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/customers')
      .then(r => r.json())
      .then(d => {
        const list: ClientOption[] = d.clients ?? [];
        setClients(list.length ? list : CLIENTS.map(c => ({ client_id: c.client_id, client_name: c.client_name })));
      })
      .catch(() =>
        setClients(CLIENTS.map(c => ({ client_id: c.client_id, client_name: c.client_name })))
      );
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = query.trim()
    ? clients.filter(c =>
        c.client_name.toLowerCase().includes(query.toLowerCase()) ||
        c.client_id.toLowerCase().includes(query.toLowerCase())
      )
    : clients.slice(0, 50);

  function pick(c: ClientOption) {
    onSelect(c.client_id, c.client_name);
    setQuery('');
    setOpen(false);
  }

  const base: React.CSSProperties = {
    padding: '6px 12px',
    borderRadius: 6,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#fff',
    fontSize: '0.8rem',
    fontFamily: 'inherit',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    ...inputStyle,
  };

  // If a client is already selected, show a chip with clear
  if (selectedId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: '0.82rem', color: '#e2e8f0', fontWeight: 500 }}>{selectedName || selectedId}</span>
          <span style={{ marginLeft: 8, fontFamily: 'monospace', fontSize: '0.68rem', color: '#a78bfa' }}>{selectedId}</span>
        </div>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            style={{ background: 'none', border: 'none', color: 'rgba(148,163,184,0.5)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
          >×</button>
        )}
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
        style={base as React.CSSProperties}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999,
          background: '#13101f', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 6, marginTop: 2, maxHeight: 220, overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {filtered.map(c => (
            <div
              key={c.client_id}
              onMouseDown={() => pick(c)}
              style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.18)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span style={{ fontSize: '0.82rem', color: '#e2e8f0' }}>{c.client_name}</span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#a78bfa', flexShrink: 0 }}>{c.client_id}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
