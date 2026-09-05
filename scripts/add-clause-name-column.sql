-- Add clause_name column to clauses table
-- Stores the heading title exactly as it appears in the document (e.g. "Services", "Indemnification")
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/afpqthxpatdmoctphhfm/sql/new

ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS clause_name TEXT;
CREATE INDEX IF NOT EXISTS clauses_clause_name ON public.clauses (clause_name);
