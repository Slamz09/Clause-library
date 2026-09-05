const STORAGE_KEY = 'consola_counterparty_types';

/** Built-in counterparty type options, always shown before any custom ones. */
export const DEFAULT_COUNTERPARTY_TYPES: string[] = ['Client', 'Service Provider', 'Independent Contractor'];

/** Returns the array of custom counterparty type labels saved by the user. */
export function getCustomCounterpartyTypes(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/**
 * Persists a new custom counterparty type label to localStorage.
 * Returns the full updated list.
 */
export function saveCustomCounterpartyType(label: string): string[] {
  const trimmed = label.trim();
  if (!trimmed) return getCustomCounterpartyTypes();
  const existing = getCustomCounterpartyTypes();
  const next = [...new Set([...existing, trimmed])];
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
