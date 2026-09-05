-- ============================================================
-- insurer_vendor_id column on insurance_policies
-- Run once in Supabase SQL Editor. Non-destructive, safe to re-run.
--
-- Links a policy/COI to the real vendor record (vendors.vendor_id, ideally
-- vendor_type = 'insurance_provider') for the carrier that issued it,
-- selected via the Document Parser's Insurer picker. The existing
-- insurance_company TEXT column stays as a fallback label for whatever the
-- LLM extracted when no vendor was matched/selected — same pattern as
-- linked_customer_ids (authoritative) vs linked_customer_names (display-only
-- fallback) on COIs.
-- ============================================================

ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS insurer_vendor_id TEXT;
