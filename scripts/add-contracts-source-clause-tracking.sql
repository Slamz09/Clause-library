-- Tracks which clause a contract-level auto-populated field actually came
-- from, so the Contracts Repository table can jump straight to (and
-- highlight) the source clause when a user clicks that cell — instead of
-- just showing a value with no way to verify where it came from.

ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS recording_rule_clause_id TEXT;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS bgc_interval_clause_id TEXT;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS governing_law_clause_id TEXT;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS effective_date_clause_id TEXT;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS expiration_date_clause_id TEXT;
