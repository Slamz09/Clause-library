-- ============================================================
-- vendor_type column on vendors
-- Run once in Supabase SQL Editor. Non-destructive, safe to re-run.
--
-- Lets a vendor be tagged by role — e.g. 'insurance_provider' for an
-- insurance carrier picked/created from the Document Parser's Insurer
-- field (see app/(app)/documents/page.tsx, ClauseExplorerTab). Nullable —
-- existing vendors stay untyped/general, nothing else changes for them.
-- ============================================================

ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS vendor_type TEXT;
