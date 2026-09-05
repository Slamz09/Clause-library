-- ============================================================
-- insurer_vendor_id column on clauses
-- Run once in Supabase SQL Editor. Non-destructive, safe to re-run.
--
-- Insurance-family clauses (Insurance Policy / COI) get the insurer's real
-- vendor id (vendors.vendor_id, vendor_type = 'insurance_provider') stamped
-- directly on the clause row at extraction time, in its own column. Filtering
-- the Insurance Clause Library by insurer reads this column directly instead
-- of joining through insurance_policies.document_id, which only works if a
-- policy row was also saved ("Save to Insurance Table" checked) and had
-- insurer_vendor_id set — a two-hop join that silently produced zero results
-- otherwise. The old join is kept as a fallback for clauses extracted before
-- this column existed.
-- ============================================================

ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS insurer_vendor_id TEXT;
