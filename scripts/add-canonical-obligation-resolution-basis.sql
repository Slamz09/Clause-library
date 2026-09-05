-- ============================================================
-- canonical_obligation_sources.resolution_role already distinguishes WHICH
-- role a source plays (controlling/supplemental/superseded/conflicting/
-- satisfied_by/needs_review), with resolution_reason as free text for the
-- "why does this apply" UI. Neither is machine-readable enough to drive
-- logic on WHY a source controls — "controlling" alone can't distinguish
-- "law controls because the contract fell below the mandatory floor" from
-- "contract controls because it validly exceeds the floor" (chat 2026-08-24).
--
-- resolution_basis adds that machine-readable layer, independent of
-- resolution_role (a row can be 'controlling' for two different reasons):
--   mandatory_law_floor        — a legal minimum the contract may not undercut;
--                                 this source is controlling because the other
--                                 source falls short of it (or there is no
--                                 other source at all)
--   contract_stricter_compatible — the contract's terms are a strict superset
--                                 of the legal floor (nothing relaxed, at
--                                 least one term tightened) — the contract
--                                 becomes the effective operational
--                                 requirement, the law is satisfied_by it
--   cumulative_independent     — law and contract each independently apply
--                                 to a different facet of the same topic and
--                                 can both be followed at once — both remain
--                                 'controlling'/'supplemental', neither
--                                 overrides the other
--   direct_conflict_law_controls — the two cannot both be followed; the
--                                 mandatory legal minimum controls to the
--                                 extent required, the contractual source is
--                                 flagged 'conflicting' for review
--   satisfied_by_other_obligation — this source's requirement is fully
--                                 discharged by evidence tied to a different
--                                 canonical_obligation_sources row (not a
--                                 comparison outcome — see resolution_role
--                                 'satisfied_by' for the row it points at)
--   requires_legal_review       — no deterministic comparator exists (e.g.
--                                 the two sources describe obligations that
--                                 don't decompose to comparable terms) — never
--                                 invent a controlling pick; resolution_role
--                                 should be 'needs_review' when this is set
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

ALTER TABLE public.canonical_obligation_sources
  ADD COLUMN IF NOT EXISTS resolution_basis TEXT;
    -- 'mandatory_law_floor' | 'contract_stricter_compatible' |
    -- 'cumulative_independent' | 'direct_conflict_law_controls' |
    -- 'satisfied_by_other_obligation' | 'requires_legal_review'

CREATE INDEX IF NOT EXISTS idx_canonical_obl_sources_resolution_basis
  ON public.canonical_obligation_sources (resolution_basis);
