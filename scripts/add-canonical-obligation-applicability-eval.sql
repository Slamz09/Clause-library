-- ============================================================
-- canonical_obligation_applicability: evaluation-state tracking.
--
-- The Clause Library's structured-obligation side panel must show, per atomic
-- obligation, how many Clients / Workers / Service Providers it applies to,
-- and must distinguish FOUR states per entity type — never collapse them to 0:
--
--   1. zero applicable      — scope resolved, the join returned no records
--   2. not yet evaluated    — no canonical_obligation_applicability row for
--                             this obligation at all
--   3. unresolved           — scope is known but a required fact is missing
--                             (evaluation_status = 'unresolved')
--   4. not applicable to    — <entity>_scope = 'not_applicable'
--      that entity type
--
-- The existing table already carries client_scope / service_provider_scope /
-- worker_scope ('specific' | 'all' | 'not_applicable'). This migration adds
-- the evaluation-status axis so state 3 is representable distinctly from
-- states 1 and 4, plus a timestamp for staleness.
--
-- Counts themselves are NEVER stored here — they are computed live from the
-- scope + the entity/relationship tables. This table records only how the
-- scope was resolved.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

ALTER TABLE public.canonical_obligation_applicability
  ADD COLUMN IF NOT EXISTS evaluation_status TEXT NOT NULL DEFAULT 'evaluated',  -- 'evaluated' | 'unresolved'
  ADD COLUMN IF NOT EXISTS unresolved_reason TEXT,
  ADD COLUMN IF NOT EXISTS evaluated_at      TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_canonical_obl_applicability_eval
  ON public.canonical_obligation_applicability (evaluation_status);
