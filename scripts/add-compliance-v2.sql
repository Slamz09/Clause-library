-- Compliance v2 migration
-- Adds party_position to documents, and risk_level / rules_score / red_flag_hits to clauses.
-- Run once against your Supabase project.

-- 1. party_position on documents (which side of the contract you occupy)
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS party_position TEXT;

-- 2. Per-clause rules-engine fields
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS risk_level      TEXT    DEFAULT 'low';
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS rules_score     INTEGER;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS red_flag_hits   TEXT[];

-- 3. Aggregate compliance score on documents (weighted average across clauses)
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS compliance_score NUMERIC(4,1);

-- Indexes for common filter/sort patterns
CREATE INDEX IF NOT EXISTS clauses_risk_level       ON public.clauses (risk_level);
CREATE INDEX IF NOT EXISTS documents_party_position ON public.documents (party_position);
