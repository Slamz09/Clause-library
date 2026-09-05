-- ============================================================
-- compliance_evaluation_log — immutable audit trail for
-- POST /api/compliance/evaluate. One row per API call, capturing who ran
-- it and the full verdict set returned, independent of the in-memory
-- computation in lib/compliance/evaluateServer.ts.
--
-- id is a Postgres-generated UUID rather than this app's usual TEXT
-- scan-max-then-increment id scheme (e.g. workers.worker_id) — that scheme
-- has a real race condition under concurrent writes (two requests can scan
-- the same max and collide), which an audit log can't tolerate.
--
-- RLS is enabled with NO policies granted (default-deny): only the
-- service-role client (lib/supabaseServer.ts's createServerClient) reads or
-- writes this table, from app/api/compliance/evaluate/route.ts only.
-- Deliberately NOT given the legacy `allow_all_anon` policy pattern other
-- tables in this schema have (a known pre-existing issue — see
-- docs/legacy-audit.md finding #2 — not replicated here).
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.compliance_evaluation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL,
  user_email TEXT,
  request_id TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT
);

CREATE INDEX IF NOT EXISTS compliance_evaluation_log_created_at_idx ON public.compliance_evaluation_log (created_at);
CREATE INDEX IF NOT EXISTS compliance_evaluation_log_user_id_idx ON public.compliance_evaluation_log (user_id);

ALTER TABLE public.compliance_evaluation_log ENABLE ROW LEVEL SECURITY;
-- No policies granted — default-deny for anon/authenticated roles.
-- service_role bypasses RLS and is the only writer/reader (route handler
-- uses createServerClient, a service_role client).
