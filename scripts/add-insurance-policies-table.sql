-- ============================================================
-- Insurance policies table
-- Run once in Supabase SQL Editor. Re-running this after today wipes any
-- insurance_policies rows added via the app (DROP TABLE below) — that's
-- fine for now while getting the schema right, but stop doing that once
-- there's real data you want to keep.
--
-- Extracted from insurance-policy documents via the Document Parser's
-- insurance extraction flow (see app/api/documents/classify-insurance).
-- Deliberately NOT part of the contracts table — an insurance policy can
-- cover multiple customers at once (linked_customer_ids), which doesn't fit
-- the one-customer-per-contract shape of `contracts`.
--
-- NOTE: an `insurance_policies` table from the OLD, already-removed
-- insurance feature (columns like carrier_name/policy_number/entity_id, no
-- policy_id or linked_customer_ids) may already exist in this project —
-- `CREATE TABLE IF NOT EXISTS` would silently skip creating the real one in
-- that case. This script drops it first. Confirmed empty/unused before
-- adding this — if you have real rows in the OLD schema you want to keep,
-- don't run this DROP; rename that table instead and re-run just the
-- CREATE TABLE block below.
-- ============================================================

DROP TABLE IF EXISTS public.insurance_policies CASCADE;

CREATE TABLE public.insurance_policies (
  policy_id           TEXT PRIMARY KEY,             -- format: INS-001
  document_id         TEXT,                          -- source parsed document
  linked_customer_ids TEXT[] NOT NULL DEFAULT '{}',  -- a policy can cover multiple customers
  coverage_type        TEXT,
  coverage_amount       TEXT,                        -- free text: LLM-extracted limits are often compound ("$1M per occurrence / $3M aggregate")
  effective_date        TEXT,
  expiration_date        TEXT,
  states                TEXT[] NOT NULL DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.insurance_policies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='insurance_policies' AND policyname='allow_all_insurance_policies') THEN
    CREATE POLICY "allow_all_insurance_policies" ON public.insurance_policies FOR ALL TO anon, service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS insurance_policies_linked_customers ON public.insurance_policies USING GIN (linked_customer_ids);

-- ============================================================
-- Added after initial creation — non-destructive, safe to re-run.
-- Distinguishes the underwriter (insurance_company) and the policyholder's
-- own entities (named_insured) from covered customers (linked_customer_ids,
-- which only a Certificate of Insurance should ever populate — see
-- app/api/documents/classify-insurance). policy_number is the carrier's own
-- policy identifier, distinct from our internal policy_id (INS-###).
-- ============================================================
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS policy_number TEXT;
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS insurance_company TEXT;
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS named_insured TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS source_document_type TEXT;
