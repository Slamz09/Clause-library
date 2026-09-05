// ─── Regulation Override Types & Merge ────────────────────────────────────────
// Extracted out of lib/useRegulationOverrides.ts (a 'use client' hook file) so
// server-side code (e.g. app/api/compliance/evaluate) can use the same merge
// logic without importing a client-only module. The hook re-exports both.

export interface RegulationOverrideRow {
  id: string;
  table_name: string;
  abbr: string;
  patch: Record<string, any>;
  updated_at: string;
  updated_by: string | null;
}

export function mergeOverride<T extends Record<string, any>>(row: T, patch?: Record<string, any>): T {
  return patch ? { ...row, ...patch } : row;
}
