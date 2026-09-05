-- ============================================================
-- Re-point vendor_id values from VEND-### to SP-###
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
--
-- The vendors table/column names are unchanged (still `vendors`/`vendor_id`
-- — see docs/vendors-drivers-schema.txt), only the ID *value* format
-- changes to match the "Service Providers" UI label. This updates existing
-- rows and cascades the value change into every other table that stores a
-- vendor_id as a loose text reference (no FK constraint enforced in
-- Postgres, so each needs its own UPDATE).
-- ============================================================

UPDATE public.vendors
  SET vendor_id = regexp_replace(vendor_id, '^VEND-', 'SP-')
  WHERE vendor_id LIKE 'VEND-%';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = 'linked_vendor_id') THEN
    UPDATE public.contracts
      SET linked_vendor_id = regexp_replace(linked_vendor_id, '^VEND-', 'SP-')
      WHERE linked_vendor_id LIKE 'VEND-%';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'insurance_policies' AND column_name = 'insurer_vendor_id') THEN
    UPDATE public.insurance_policies
      SET insurer_vendor_id = regexp_replace(insurer_vendor_id, '^VEND-', 'SP-')
      WHERE insurer_vendor_id LIKE 'VEND-%';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clauses' AND column_name = 'insurer_vendor_id') THEN
    UPDATE public.clauses
      SET insurer_vendor_id = regexp_replace(insurer_vendor_id, '^VEND-', 'SP-')
      WHERE insurer_vendor_id LIKE 'VEND-%';
  END IF;
END $$;

-- service_engagements.vendor_id (3rd-party vendor on a service engagement) —
-- only applies once scripts/rename-rides-to-service-engagements.sql has run;
-- guarded so this script is safe to run before or after that one.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_engagements' AND column_name = 'vendor_id') THEN
    UPDATE public.service_engagements
      SET vendor_id = regexp_replace(vendor_id, '^VEND-', 'SP-')
      WHERE vendor_id LIKE 'VEND-%';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rides' AND column_name = 'vendor_id') THEN
    UPDATE public.rides
      SET vendor_id = regexp_replace(vendor_id, '^VEND-', 'SP-')
      WHERE vendor_id LIKE 'VEND-%';
  END IF;
END $$;
