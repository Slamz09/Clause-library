-- Regulation Overrides table
-- Sparse patch-overlay for the static regulation tables in lib/regulationData.ts
-- (Privacy, Data Security, Driver Requirements, Recording Consent). The static
-- arrays remain the seed source of truth; each row here is a partial diff for
-- one state within one table, merged on top at render time.
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/afpqthxpatdmoctphhfm/sql/new

CREATE TABLE IF NOT EXISTS public.regulation_overrides (
  id          TEXT PRIMARY KEY,              -- `${table_name}:${abbr}`
  table_name  TEXT NOT NULL,                 -- 'privacy' | 'data-security' | 'driver-req' | 'recording-consent'
  abbr        TEXT NOT NULL,
  patch       JSONB NOT NULL DEFAULT '{}',
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (table_name, abbr)
);

CREATE INDEX IF NOT EXISTS regulation_overrides_table_name ON public.regulation_overrides (table_name);
