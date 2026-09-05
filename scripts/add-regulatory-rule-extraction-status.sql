-- ============================================================
-- Distinguishes RULE-EXTRACTION uncertainty from FACT-RESOLUTION
-- uncertainty on regulatory_applicability_rules — these are different axes
-- and must not collapse into one field (see docs/ontology-implementation-
-- plan.md Step 3 / chat 2026-08-24):
--
--   extraction_status  — a property of the RULE itself, independent of any
--                         subject: did the source text state this condition
--                         clearly enough to represent as a typed predicate?
--   review_status       — already exists on regulatory_applicability_
--                         determinations — a property of one EVALUATION for
--                         one subject: could we resolve whether THIS subject
--                         satisfies the (already-formalized) predicates?
--
-- A leaf rule node is either 'extracted' (has a real row in
-- regulatory_applicability_predicates) or 'unformalized' — the source text
-- states a condition (e.g. "a covered contractor performing pupil
-- transportation for a local educational agency") that resists safe
-- reduction to a typed operator/comparison_value without interpretation.
-- unformalized_condition_text preserves that condition in the source's own
-- terms rather than forcing false precision. An 'unformalized' leaf still
-- participates in its parent AND/OR tree — it evaluates to 'unknown' at
-- determination time — it is not silently dropped from the rule.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

ALTER TABLE public.regulatory_applicability_rules
  ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'extracted',
    -- 'extracted' | 'unformalized'
  ADD COLUMN IF NOT EXISTS unformalized_condition_text TEXT;

CREATE INDEX IF NOT EXISTS idx_reg_appl_rules_extraction_status
  ON public.regulatory_applicability_rules (extraction_status);
