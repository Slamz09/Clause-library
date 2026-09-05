-- Add compliance result columns to clauses table
-- Run this directly in Supabase SQL Editor — no other dependencies required.

ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS compliance_status TEXT    DEFAULT 'unchecked';
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS compliance_notes  TEXT;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS compliance_score  INTEGER;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS playbook_id       TEXT;

CREATE INDEX IF NOT EXISTS clauses_compliance_status ON public.clauses (compliance_status);

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'clauses'
  AND column_name IN ('compliance_status', 'compliance_notes', 'compliance_score', 'playbook_id')
ORDER BY column_name;
