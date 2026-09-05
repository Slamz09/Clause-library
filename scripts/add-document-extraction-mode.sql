-- Migration: add extraction mode tracking column to documents table

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS extraction_mode TEXT NOT NULL DEFAULT 'standard',  -- 'standard' | 'deep'
  ADD COLUMN IF NOT EXISTS deep_extracted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_documents_extraction_mode ON public.documents (extraction_mode);
