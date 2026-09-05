-- Migration: add hierarchy and atomic unit tracking columns to the clauses table

ALTER TABLE public.clauses
  ADD COLUMN IF NOT EXISTS parent_clause_id    TEXT NULL REFERENCES clauses(clause_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS clause_depth        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clause_path         TEXT NULL,        -- e.g. "3.1.2"
  ADD COLUMN IF NOT EXISTS section_heading     TEXT NULL,
  ADD COLUMN IF NOT EXISTS structural_labels   TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS topic_labels        TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS unit_count          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS obligation_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS has_units           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extraction_mode     TEXT NOT NULL DEFAULT 'standard';  -- 'standard' | 'deep'

CREATE INDEX IF NOT EXISTS idx_clauses_parent_clause_id ON public.clauses (parent_clause_id);
CREATE INDEX IF NOT EXISTS idx_clauses_has_units        ON public.clauses (has_units) WHERE has_units = true;
CREATE INDEX IF NOT EXISTS idx_clauses_extraction_mode  ON public.clauses (extraction_mode);
