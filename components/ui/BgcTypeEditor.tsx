'use client';
import { BGC_SCREENING_TYPES, BGC_JURISDICTION_LEVELS, BGC_TYPES_WITH_JURISDICTION, BGC_ALL_STATES, type BgcTypeRequirement, type BgcScreeningType, type BgcJurisdictionLevel } from '@/lib/bgcTypeOptions';
import { US_STATES } from '@/lib/geoOptions';

const PILL_BASE: React.CSSProperties = {
  padding: '3px 10px', borderRadius: 99, fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit',
  border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'var(--text-muted)',
};
const PILL_ACTIVE: React.CSSProperties = {
  border: '1px solid rgba(124,58,237,0.5)', background: 'rgba(124,58,237,0.18)', color: '#a78bfa',
};

/**
 * Multi-select BGC screening-method requirement editor: pick Name Search
 * and/or Fingerprinting, and for each, which jurisdiction level(s) apply.
 * `showStates` (workers table only) adds a specific-states picker under any
 * type with 'State' selected — 'All' collapses the rest of the picker.
 */
export function BgcTypeEditor({ value, onChange, showStates = false }: {
  value: BgcTypeRequirement[];
  onChange: (v: BgcTypeRequirement[]) => void;
  showStates?: boolean;
}) {
  const byType = new Map(value.map(r => [r.type, r]));

  function toggleType(type: BgcScreeningType) {
    if (byType.has(type)) {
      onChange(value.filter(r => r.type !== type));
    } else {
      onChange([...value, { type, jurisdiction: [] }]);
    }
  }

  function updateType(type: BgcScreeningType, patch: Partial<BgcTypeRequirement>) {
    onChange(value.map(r => (r.type === type ? { ...r, ...patch } : r)));
  }

  function toggleJurisdiction(type: BgcScreeningType, level: BgcJurisdictionLevel) {
    const req = byType.get(type);
    if (!req) return;
    const has = req.jurisdiction.includes(level);
    const jurisdiction = has ? req.jurisdiction.filter(j => j !== level) : [...req.jurisdiction, level];
    const states = level === 'State' && has ? undefined : req.states;
    updateType(type, { jurisdiction, states });
  }

  function toggleState(type: BgcScreeningType, abbr: string) {
    const req = byType.get(type);
    if (!req) return;
    if (abbr === BGC_ALL_STATES) {
      updateType(type, { states: req.states?.includes(BGC_ALL_STATES) ? [] : [BGC_ALL_STATES] });
      return;
    }
    const current = (req.states || []).filter(s => s !== BGC_ALL_STATES);
    const states = current.includes(abbr) ? current.filter(s => s !== abbr) : [...current, abbr];
    updateType(type, { states });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {BGC_SCREENING_TYPES.map(type => {
          const active = byType.has(type);
          return (
            <button key={type} type="button" onClick={() => toggleType(type)}
              style={{ ...PILL_BASE, ...(active ? PILL_ACTIVE : {}) }}>
              {type}
            </button>
          );
        })}
      </div>

      {value.map(req => {
        const hasJurisdiction = BGC_TYPES_WITH_JURISDICTION.includes(req.type);
        return (
        <div key={req.type} style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{req.type}{hasJurisdiction ? ':' : ''}</span>
            {hasJurisdiction && BGC_JURISDICTION_LEVELS.map(level => {
              const active = req.jurisdiction.includes(level);
              return (
                <button key={level} type="button" onClick={() => toggleJurisdiction(req.type, level)}
                  style={{ ...PILL_BASE, ...(active ? PILL_ACTIVE : {}) }}>
                  {level}
                </button>
              );
            })}
          </div>

          {hasJurisdiction && showStates && req.jurisdiction.includes('State') && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingTop: 4, borderTop: '1px solid var(--border-color)' }}>
              <button type="button" onClick={() => toggleState(req.type, BGC_ALL_STATES)}
                style={{ ...PILL_BASE, fontSize: '0.68rem', ...(req.states?.includes(BGC_ALL_STATES) ? PILL_ACTIVE : {}) }}>
                All States
              </button>
              {!req.states?.includes(BGC_ALL_STATES) && US_STATES.map(s => {
                const active = !!req.states?.includes(s.value);
                return (
                  <button key={s.value} type="button" onClick={() => toggleState(req.type, s.value)}
                    style={{ ...PILL_BASE, fontSize: '0.68rem', ...(active ? PILL_ACTIVE : {}) }}>
                    {s.value}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}
