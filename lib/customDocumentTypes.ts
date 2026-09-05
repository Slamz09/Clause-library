const STORAGE_KEY = 'consola_contract_types';

/** Returns the array of custom contract type display labels saved by the user. */
export function getCustomDocumentTypes(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/** Converts a display label to a document_type slug value. */
export function labelToDocTypeValue(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Persists a new custom contract type label to localStorage.
 * Returns the full updated list.
 */
export function saveCustomDocumentType(label: string): string[] {
  const trimmed = label.trim();
  if (!trimmed) return getCustomDocumentTypes();
  const existing = getCustomDocumentTypes();
  const next = [...new Set([...existing, trimmed])];
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
