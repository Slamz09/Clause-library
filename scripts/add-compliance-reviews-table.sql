-- Compliance Reviews table
-- Stores each AI-powered contract compliance checklist run.
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/afpqthxpatdmoctphhfm/sql/new

CREATE TABLE IF NOT EXISTS public.compliance_reviews (
  review_id       UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     TEXT    NOT NULL,
  document_title  TEXT,
  document_type   TEXT,
  results         JSONB   NOT NULL DEFAULT '{}',
  red_flag_count  INTEGER NOT NULL DEFAULT 0,
  found_count     INTEGER NOT NULL DEFAULT 0,
  missing_count   INTEGER NOT NULL DEFAULT 0,
  flagged_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS compliance_reviews_document_id ON public.compliance_reviews (document_id);
CREATE INDEX IF NOT EXISTS compliance_reviews_created_at  ON public.compliance_reviews (created_at DESC);
