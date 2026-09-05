-- SUPERSEDED 2026-08-23 — never applied to the live database (confirmed via
-- direct query and via the running app's own API returning PGRST205 "table
-- not found"). Use scripts/create-obligations-table.sql instead: same
-- columns/indexes as below, but with the default-deny RLS posture this app
-- has since standardized on, replacing this file's `USING (true)` policies
-- (which would allow anon/authenticated read-write directly via the
-- Supabase REST API). Kept here for history only — do not run this file.
--
-- Migration: add obligations table for normalized monitorable duties
-- Each row is one normalized obligation derived from a clause_unit.

CREATE TABLE IF NOT EXISTS public.obligations (
  obligation_id         TEXT PRIMARY KEY,
  clause_unit_id        TEXT NULL REFERENCES clause_units(clause_unit_id) ON DELETE SET NULL,
  clause_id             TEXT NOT NULL REFERENCES clauses(clause_id) ON DELETE CASCADE,
  document_id           TEXT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
  obligation_kind       TEXT NOT NULL,        -- 'duty' | 'prohibition' | 'right' | 'condition' | 'definition' | 'representation' | 'warranty'
  actor                 TEXT NULL,
  beneficiary           TEXT NULL,
  action_text           TEXT NOT NULL,
  object_text           TEXT NULL,
  trigger_text          TEXT NULL,
  deadline_text         TEXT NULL,
  frequency_text        TEXT NULL,
  qualifier_text        TEXT NULL,
  exception_text        TEXT NULL,
  topic_labels          TEXT[] NOT NULL DEFAULT '{}',
  canonical_clause_type TEXT NULL,
  is_conditional        BOOLEAN NOT NULL DEFAULT false,
  condition_text        TEXT NULL,
  monetary_amount       NUMERIC NULL,
  monetary_currency     TEXT NULL DEFAULT 'USD',
  time_period_days      INTEGER NULL,
  evidence_hint         TEXT NULL,
  monitor_flag          BOOLEAN NOT NULL DEFAULT false,
  needs_review          BOOLEAN NOT NULL DEFAULT false,
  review_reason         TEXT NULL,
  status                TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'superseded' | 'waived'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obligations_clause_id      ON public.obligations (clause_id);
CREATE INDEX IF NOT EXISTS idx_obligations_document_id    ON public.obligations (document_id);
CREATE INDEX IF NOT EXISTS idx_obligations_clause_unit_id ON public.obligations (clause_unit_id);
CREATE INDEX IF NOT EXISTS idx_obligations_kind           ON public.obligations (obligation_kind);
CREATE INDEX IF NOT EXISTS idx_obligations_monitor        ON public.obligations (monitor_flag) WHERE monitor_flag = true;
CREATE INDEX IF NOT EXISTS idx_obligations_review         ON public.obligations (needs_review) WHERE needs_review = true;

ALTER TABLE public.obligations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "obligations_select" ON public.obligations
  FOR SELECT USING (true);

CREATE POLICY "obligations_insert" ON public.obligations
  FOR INSERT WITH CHECK (true);

CREATE POLICY "obligations_update" ON public.obligations
  FOR UPDATE USING (true);
