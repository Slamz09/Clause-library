-- Migration: add clause_units table for hierarchical clause extraction
-- Each row is one atomic legal unit extracted from a clause section.

CREATE TABLE IF NOT EXISTS public.clause_units (
  clause_unit_id        TEXT PRIMARY KEY,
  clause_id             TEXT NOT NULL REFERENCES clauses(clause_id) ON DELETE CASCADE,
  document_id           TEXT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
  unit_index            INTEGER NOT NULL,
  parent_unit_id        TEXT NULL REFERENCES clause_units(clause_unit_id) ON DELETE CASCADE,
  unit_text             TEXT NOT NULL,
  unit_text_normalized  TEXT NULL,
  structural_labels     TEXT[] NOT NULL DEFAULT '{}',
  topic_labels          TEXT[] NOT NULL DEFAULT '{}',
  actor                 TEXT NULL,
  beneficiary           TEXT NULL,
  defined_term          TEXT NULL,
  definition_type       TEXT NULL,
  trigger_text          TEXT NULL,
  action_text           TEXT NULL,
  object_text           TEXT NULL,
  qualifier_text        TEXT NULL,
  exception_text        TEXT NULL,
  deadline_text         TEXT NULL,
  frequency_text        TEXT NULL,
  source_page           INTEGER NULL,
  char_start            INTEGER NULL,
  char_end              INTEGER NULL,
  extraction_method     TEXT NOT NULL DEFAULT 'llm',
  extraction_confidence NUMERIC NULL,
  structure_confidence  NUMERIC NULL,
  topic_confidence      NUMERIC NULL,
  needs_review          BOOLEAN NOT NULL DEFAULT false,
  review_reason         TEXT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clause_units_clause_id   ON public.clause_units (clause_id);
CREATE INDEX IF NOT EXISTS idx_clause_units_document_id ON public.clause_units (document_id);
CREATE INDEX IF NOT EXISTS idx_clause_units_parent      ON public.clause_units (parent_unit_id);
CREATE INDEX IF NOT EXISTS idx_clause_units_review      ON public.clause_units (needs_review) WHERE needs_review = true;

ALTER TABLE public.clause_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clause_units_select" ON public.clause_units
  FOR SELECT USING (true);

CREATE POLICY "clause_units_insert" ON public.clause_units
  FOR INSERT WITH CHECK (true);

CREATE POLICY "clause_units_update" ON public.clause_units
  FOR UPDATE USING (true);
