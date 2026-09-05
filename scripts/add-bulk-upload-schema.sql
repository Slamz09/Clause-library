-- Bulk contract upload: batch tracking + queue columns on document_uploads,
-- plus an atomic job-claim function so concurrent worker invocations (the
-- opportunistic post-enqueue trigger and the scheduled poller) never process
-- the same row twice. Reuses document_uploads as the per-document job record
-- instead of a parallel jobs table — it already carries document_id,
-- extraction_status, and extracted_count.

CREATE TABLE IF NOT EXISTS public.document_batches (
  batch_id TEXT PRIMARY KEY,
  total_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing', -- processing | completed | completed_with_errors
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- document_type is no longer known at enqueue time for a bulk job (it's
-- filled in once the worker classifies the file — see
-- lib/documents/classifyDocument.ts) — the pre-existing NOT NULL constraint
-- predates automatic classification and must be dropped for bulk rows.
ALTER TABLE public.document_uploads ALTER COLUMN document_type DROP NOT NULL;

ALTER TABLE public.document_uploads ADD COLUMN IF NOT EXISTS batch_id TEXT;
ALTER TABLE public.document_uploads ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;
ALTER TABLE public.document_uploads ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE public.document_uploads ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE public.document_uploads ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
-- Per-file metadata needed to replay the same call processDocumentUpload()
-- would receive from a single-document upload (document types, entity/asset
-- ids, company/counterparty names, governing state, parent doc link, deep
-- extract flag) — captured once at enqueue time, read back by the worker.
ALTER TABLE public.document_uploads ADD COLUMN IF NOT EXISTS upload_meta JSONB;

CREATE INDEX IF NOT EXISTS idx_document_uploads_batch_id ON public.document_uploads(batch_id);
CREATE INDEX IF NOT EXISTS idx_document_uploads_queued ON public.document_uploads(created_at) WHERE extraction_status = 'queued';

-- The claim_next_bulk_upload_job() function is in its own file —
-- scripts/add-bulk-upload-claim-function.sql — run it separately, in its own
-- SQL Editor query tab. (Supabase's dashboard can auto-insert an "Enable Row
-- Level Security" suggestion into the editor buffer right after a CREATE
-- TABLE runs; if that lands mid-paste inside this function's $$...$$ body it
-- breaks the dollar-quoting. Keeping the function isolated avoids that.)
