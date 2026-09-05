-- ============================================================
-- Clause Library v2 — new metadata columns
-- Run once in Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
-- ============================================================

-- Survives-termination flag (drives STATUS computation)
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS survives_termination BOOLEAN NOT NULL DEFAULT false;

-- Paper source: who drafted the clause ('counter_party' | 'internal')
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS paper_source TEXT;

-- Which departments must approve this clause (array: 'legal','it','operations','finance','pricing')
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS approval_needed TEXT[] NOT NULL DEFAULT '{}';

-- Per-approver details stored as JSONB map
-- Example: { "legal": { "approved_by": "J. Smith", "approved_on": "2026-01-15", "approval_requested_on": "2026-01-10" } }
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS approval_details JSONB;

-- Clause version number ('1st', '2nd', ... '10th')
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS version_no TEXT;

CREATE INDEX IF NOT EXISTS clauses_paper_source   ON public.clauses (paper_source);
CREATE INDEX IF NOT EXISTS clauses_version_no     ON public.clauses (version_no);
