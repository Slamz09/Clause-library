-- ============================================================
-- tax_status column on vendors and drivers
-- Run once in Supabase SQL Editor. Non-destructive, safe to re-run.
--
-- Worker/business tax classification ("1099 IC", "Business", "Employee")
-- shown on the Service Providers table/side panel and the Drivers table.
-- Nullable — existing rows have no tax status recorded, nothing else
-- changes for them. See lib/vendorTypes.ts TAX_STATUS_OPTIONS for the
-- allowed values (enforced in the UI, not a DB constraint).
-- ============================================================

ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS tax_status TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS tax_status TEXT;
