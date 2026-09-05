-- Run this in its OWN, freshly-opened SQL Editor query tab — not appended to
-- or combined with any other script. Supabase's dashboard can auto-insert an
-- "Enable Row Level Security" suggestion into the editor buffer right after
-- a CREATE TABLE statement runs; if that lands in the middle of this
-- function's tagged dollar-quoted body it breaks the parser ("unterminated
-- dollar-quoted string"). Running it alone, in a clean tab, avoids that.
--
-- Requires scripts/add-bulk-upload-schema.sql to have been run first
-- (this function selects from public.document_uploads).

-- Atomically claims the oldest queued job and flips it to 'processing' in one
-- statement (FOR UPDATE SKIP LOCKED), so two workers racing to drain the same
-- batch never grab the same row.
CREATE OR REPLACE FUNCTION public.claim_next_bulk_upload_job()
RETURNS SETOF public.document_uploads
LANGUAGE plpgsql
AS $fn$
DECLARE
  claimed_id TEXT;
BEGIN
  SELECT upload_id INTO claimed_id
  FROM public.document_uploads
  WHERE extraction_status = 'queued'
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF claimed_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.document_uploads
  SET extraction_status = 'processing', started_at = NOW()
  WHERE upload_id = claimed_id
  RETURNING *;
END;
$fn$;
