-- ============================================================
-- Migrate drivers -> workers, vendors -> service_providers
-- Run once in Supabase SQL Editor, AFTER scripts/rename-vend-to-sp-vendor-ids.sql
-- and scripts/rename-customers-to-clients.sql have both been applied.
-- Safe to re-run (idempotent).
--
-- This is an architectural merge, not just a rename:
--   - `drivers` becomes `workers`, generalized to any person performing work
--     for a service provider (Driver, Nurse, Caregiver, Security Guard,
--     Technician, Inspector, Interpreter, ...). All existing rows get
--     worker_type = 'Driver' (the only role previously tracked) and keep
--     their BGC/background-check columns (bgc_status, bgc_type,
--     first_bgc_date, last_bgc_date, bgc_duration,
--     assigned_service_engagements_count, linked_incidents,
--     linked_complaints, client_id) as real typed columns — the BGC cadence
--     engine (lib/bgcCompliance.ts) needs them queryable, not buried in a
--     JSON blob.
--   - `vendors` becomes `service_providers`: vendor_name splits into
--     legal_name (required) + display_name (optional, NULL on migrated
--     rows), vendor_type becomes provider_type, a new entity_type and phone
--     column are added, and tax_status is DROPPED — relationship_type on
--     the new workers table supersedes it.
--   - service_engagements.driver_id becomes worker_id, re-pointed from
--     DRV-### to W-### id values (workers.worker_id is re-pointed the same
--     way, cascading everywhere driver_id was referenced as text).
-- ============================================================

-- ── workers (from drivers) ──────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'drivers')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'workers') THEN
    ALTER TABLE public.drivers RENAME TO workers;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workers' AND column_name = 'driver_id') THEN
    ALTER TABLE public.workers RENAME COLUMN driver_id TO worker_id;
  END IF;
END $$;

ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS service_provider_id TEXT;
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS worker_type TEXT;
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS relationship_type TEXT;
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS qualifications JSONB;
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS compliance_status TEXT;
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS notes TEXT;

-- Backfill required/defaulted columns on existing rows before enforcing NOT NULL
UPDATE public.workers SET worker_type = 'Driver' WHERE worker_type IS NULL;
UPDATE public.workers SET legal_name = 'Worker ' || worker_id WHERE legal_name IS NULL;
UPDATE public.workers SET status = 'Active' WHERE status IS NULL;
-- relationship_type migrated from the old tax_status field (dropped below)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workers' AND column_name = 'tax_status') THEN
    UPDATE public.workers SET relationship_type = CASE tax_status
      WHEN '1099 IC' THEN '1099 Contractor'
      WHEN 'Business' THEN 'Subcontractor'
      WHEN 'Employee' THEN 'Employee'
      ELSE 'Employee'
    END
    WHERE relationship_type IS NULL;
    ALTER TABLE public.workers DROP COLUMN tax_status;
  ELSE
    UPDATE public.workers SET relationship_type = 'Employee' WHERE relationship_type IS NULL;
  END IF;
END $$;

ALTER TABLE public.workers ALTER COLUMN worker_type SET NOT NULL;
ALTER TABLE public.workers ALTER COLUMN legal_name SET NOT NULL;
ALTER TABLE public.workers ALTER COLUMN relationship_type SET NOT NULL;
ALTER TABLE public.workers ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.workers ALTER COLUMN status SET DEFAULT 'Active';

-- Re-point existing DRV-### ids to W-### (idempotent)
UPDATE public.workers SET worker_id = regexp_replace(worker_id, '^DRV-', 'W-') WHERE worker_id LIKE 'DRV-%';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_engagements' AND column_name = 'worker_id') THEN
    UPDATE public.service_engagements SET worker_id = regexp_replace(worker_id, '^DRV-', 'W-') WHERE worker_id LIKE 'DRV-%';
  END IF;
END $$;

-- ── service_engagements.driver_id -> worker_id ──────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_engagements' AND column_name = 'driver_id') THEN
    ALTER TABLE public.service_engagements RENAME COLUMN driver_id TO worker_id;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'service_engagements_driver_id') THEN
    ALTER INDEX public.service_engagements_driver_id RENAME TO service_engagements_worker_id;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'drivers_customer_id') THEN
    ALTER INDEX public.drivers_customer_id RENAME TO workers_client_id;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workers' AND policyname = 'allow_all_drivers') THEN
    ALTER POLICY allow_all_drivers ON public.workers RENAME TO allow_all_workers;
  END IF;
END $$;

-- ── incidents/complaints (mock-only today — guarded in case a live table exists) ──
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidents' AND column_name = 'linked_driver_id') THEN
    ALTER TABLE public.incidents RENAME COLUMN linked_driver_id TO linked_worker_id;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'complaints' AND column_name = 'linked_driver_ids') THEN
    ALTER TABLE public.complaints RENAME COLUMN linked_driver_ids TO linked_worker_ids;
  END IF;
END $$;

-- ── service_providers (from vendors) ────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vendors')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'service_providers') THEN
    ALTER TABLE public.vendors RENAME TO service_providers;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_providers' AND column_name = 'vendor_id') THEN
    ALTER TABLE public.service_providers RENAME COLUMN vendor_id TO service_provider_id;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_providers' AND column_name = 'vendor_name') THEN
    ALTER TABLE public.service_providers RENAME COLUMN vendor_name TO legal_name;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_providers' AND column_name = 'vendor_type') THEN
    ALTER TABLE public.service_providers RENAME COLUMN vendor_type TO provider_type;
  END IF;
END $$;

ALTER TABLE public.service_providers ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.service_providers ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE public.service_providers ADD COLUMN IF NOT EXISTS phone TEXT;

UPDATE public.service_providers SET entity_type = 'Organization' WHERE entity_type IS NULL;
ALTER TABLE public.service_providers ALTER COLUMN entity_type SET NOT NULL;
ALTER TABLE public.service_providers ALTER COLUMN entity_type SET DEFAULT 'Organization';

-- tax_status dropped — relationship_type on workers supersedes it
ALTER TABLE public.service_providers DROP COLUMN IF EXISTS tax_status;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'service_providers' AND policyname = 'allow_all_vendors') THEN
    ALTER POLICY allow_all_vendors ON public.service_providers RENAME TO allow_all_service_providers;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'vendors_vendor_name') THEN
    ALTER INDEX public.vendors_vendor_name RENAME TO service_providers_legal_name;
  END IF;
END $$;

-- ── insurance_policies / contracts / clauses / service_engagements that
--    reference a service provider by id keep the loose-text column name
--    (linked_vendor_id, insurer_vendor_id, vendor_id/vendor_name) — only the
--    referenced *table* changed identity, not those column names, since
--    they're already namespaced clearly enough and renaming them again
--    would be pure churn. No action needed here.
