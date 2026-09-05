-- ============================================================
-- canonical_obligation_sources: clause_unit_id back-reference.
--
-- canonical_obligation_sources already records the source clause_id +
-- document_id for every canonical obligation. This adds the finer-grained
-- link to the specific clause_units row the obligation was decomposed from,
-- so the structured-obligation side panel can show which atomic unit of a
-- multi-unit clause each obligation came from, and so re-running segmentation
-- can be reconciled against existing canonical rows.
--
-- Nullable: regulation-sourced obligations and any obligation ingested before
-- clause_units population have no unit row to point at.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

ALTER TABLE public.canonical_obligation_sources
  ADD COLUMN IF NOT EXISTS clause_unit_id TEXT REFERENCES public.clause_units(clause_unit_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_obl_sources_clause_unit
  ON public.canonical_obligation_sources (clause_unit_id);
