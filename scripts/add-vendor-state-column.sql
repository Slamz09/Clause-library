-- ============================================================
-- state column on vendors
-- Run once in Supabase SQL Editor. Non-destructive, safe to re-run.
--
-- US state (2-letter code, e.g. "NY") for the vendor's location — shown
-- on the Vendors table and side panel. Nullable — existing vendors have
-- no state recorded, nothing else changes for them.
-- ============================================================

ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS state TEXT;
