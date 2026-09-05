-- ============================================================
-- Clause Library: Category + Modifiers as first-class, distinct concepts.
--
-- Category and Modifiers are SEPARATE from clause_type (the CUAD-style
-- CANONICAL_CLAUSE_TYPES topic taxonomy) and from a derived obligation's
-- requirement_effect (canonical_obligations.requirement_effect). See
-- lib/clauses/clauseCategories.ts for the controlled vocabularies.
--
--   category  — what the source language IS, as drafted. Multi-value only
--               when the clause genuinely contains multiple legal forms /
--               atomic units. Allowed: 'obligation' | 'rep_warranty' |
--               'acknowledgment' | 'statement' | 'definition'.
--   modifiers — condition / qualification / exception language attached to
--               the principal clause. Any combination. Allowed:
--               'condition' | 'qualification' | 'exception'.
--
-- Deliberately NOT reusing clauses.structural_labels: that column is empty on
-- every live row, has no producer or consumer, and flattens form + modifier +
-- effect into one array — incompatible with keeping these axes distinct.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

ALTER TABLE public.clauses
  ADD COLUMN IF NOT EXISTS category  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS modifiers TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_clauses_category  ON public.clauses USING GIN (category);
CREATE INDEX IF NOT EXISTS idx_clauses_modifiers ON public.clauses USING GIN (modifiers);
