-- ============================================================
-- capabilities column on vendors
-- Run once in Supabase SQL Editor. Non-destructive, safe to re-run.
--
-- Stores the per-category capability checklist shown on the Vendors page
-- (Add Vendor modal + side panel) as flat JSON, e.g.
-- {"vehicle.wheelchair_lift": true, "vehicle.type": "Van", "vehicle.seats": 12}
-- See lib/vendorCapabilities.ts for the field definitions per category.
-- Nullable — existing vendors have no capabilities recorded, nothing else
-- changes for them.
-- ============================================================

ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS capabilities JSONB;
