-- ============================================================
-- Clause Library + structured-obligation consolidation.
-- Run once in the Supabase SQL Editor (SQL > New query > paste > Run).
-- Every statement is idempotent (IF NOT EXISTS); safe to re-run.
--
-- Bundles, in order:
--   1. add-clause-category-modifiers.sql
--   2. add-canonical-obligation-effect-derivation.sql
--   3. add-canonical-obligation-sources-clause-unit.sql
--   4. add-canonical-obligation-applicability-eval.sql
--
-- Verified against the live schema 2026-08-30: clauses (240 rows),
-- clause_units (0), canonical_obligations (425), canonical_obligation_sources
-- (425), canonical_obligation_applicability (0) all already exist.
-- ============================================================

-- 1. clauses.category / clauses.modifiers ---------------------------------------
ALTER TABLE public.clauses
  ADD COLUMN IF NOT EXISTS category  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS modifiers TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_clauses_category  ON public.clauses USING GIN (category);
CREATE INDEX IF NOT EXISTS idx_clauses_modifiers ON public.clauses USING GIN (modifiers);

-- 2. canonical_obligations.requirement_effect / .derivation --------------------
ALTER TABLE public.canonical_obligations
  ADD COLUMN IF NOT EXISTS requirement_effect TEXT,   -- 'duty'|'prohibition'|'permission'|'right'|'none'
  ADD COLUMN IF NOT EXISTS derivation         TEXT;   -- 'explicit'|'derived'
UPDATE public.canonical_obligations SET derivation = 'explicit' WHERE derivation IS NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_obligations_effect     ON public.canonical_obligations (requirement_effect);
CREATE INDEX IF NOT EXISTS idx_canonical_obligations_derivation ON public.canonical_obligations (derivation);

-- 3. canonical_obligation_sources.clause_unit_id ------------------------------
ALTER TABLE public.canonical_obligation_sources
  ADD COLUMN IF NOT EXISTS clause_unit_id TEXT REFERENCES public.clause_units(clause_unit_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_obl_sources_clause_unit
  ON public.canonical_obligation_sources (clause_unit_id);

-- 4. canonical_obligation_applicability evaluation state ----------------------
ALTER TABLE public.canonical_obligation_applicability
  ADD COLUMN IF NOT EXISTS evaluation_status TEXT NOT NULL DEFAULT 'evaluated',  -- 'evaluated'|'unresolved'
  ADD COLUMN IF NOT EXISTS unresolved_reason TEXT,
  ADD COLUMN IF NOT EXISTS evaluated_at      TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_canonical_obl_applicability_eval
  ON public.canonical_obligation_applicability (evaluation_status);
