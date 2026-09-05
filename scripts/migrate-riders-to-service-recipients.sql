-- ============================================================
-- Migrate riders -> service_recipients
-- Run once in Supabase SQL Editor, AFTER scripts/rename-customers-to-clients.sql
-- and scripts/rename-rides-to-service-engagements.sql have both been applied.
-- Safe to re-run (idempotent).
--
-- This generalizes the transportation-only "Rider" concept into a
-- cross-industry "Service Recipient" (Rider/Student, Patient, Patient/
-- Member, Building occupant/Visitor, Customer/Resident, Property owner,
-- Customer site contact, ...):
--   - `riders` becomes `service_recipients`, rider_id becomes
--     service_recipient_id (re-pointed from RDR-### to SR-### id values,
--     cascading everywhere rider_id was referenced as text).
--   - video_consent_status becomes consent_status (same 'opt-in'/'opt-out'
--     values — the field is renamed, not restructured).
--   - state becomes jurisdiction (same 2-letter-code values).
--   - New columns: recipient_type (defaults to 'Rider / Student' for
--     existing rows — this app's original/only industry to date), name
--     (the individual's own display name — did not exist before, defaults
--     to '' on migrated rows), privacy_preferences, special_requirements.
--   - service_engagements.linked_rider_ids becomes
--     linked_service_recipient_ids, incidents.linked_rider_ids becomes
--     linked_service_recipient_ids — both re-pointed from RDR-### to SR-###
--     id values inside the array.
-- ============================================================

-- ── service_recipients (from riders) ────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'riders')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'service_recipients') THEN
    ALTER TABLE public.riders RENAME TO service_recipients;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_recipients' AND column_name = 'rider_id') THEN
    ALTER TABLE public.service_recipients RENAME COLUMN rider_id TO service_recipient_id;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_recipients' AND column_name = 'video_consent_status') THEN
    ALTER TABLE public.service_recipients RENAME COLUMN video_consent_status TO consent_status;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_recipients' AND column_name = 'state') THEN
    ALTER TABLE public.service_recipients RENAME COLUMN state TO jurisdiction;
  END IF;
END $$;

ALTER TABLE public.service_recipients ADD COLUMN IF NOT EXISTS recipient_type TEXT;
ALTER TABLE public.service_recipients ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.service_recipients ADD COLUMN IF NOT EXISTS privacy_preferences TEXT;
ALTER TABLE public.service_recipients ADD COLUMN IF NOT EXISTS special_requirements TEXT;

-- Backfill required columns on existing rows before enforcing NOT NULL
UPDATE public.service_recipients SET recipient_type = 'Rider / Student' WHERE recipient_type IS NULL;
UPDATE public.service_recipients SET name = 'Service Recipient ' || service_recipient_id WHERE name IS NULL;

ALTER TABLE public.service_recipients ALTER COLUMN recipient_type SET NOT NULL;
ALTER TABLE public.service_recipients ALTER COLUMN recipient_type SET DEFAULT 'Rider / Student';
ALTER TABLE public.service_recipients ALTER COLUMN name SET NOT NULL;

-- Re-point existing RDR-### ids to SR-### (idempotent)
UPDATE public.service_recipients SET service_recipient_id = regexp_replace(service_recipient_id, '^RDR-', 'SR-') WHERE service_recipient_id LIKE 'RDR-%';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'service_recipients' AND policyname = 'allow_all_riders') THEN
    ALTER POLICY allow_all_riders ON public.service_recipients RENAME TO allow_all_service_recipients;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'riders_customer_id') THEN
    ALTER INDEX public.riders_customer_id RENAME TO service_recipients_client_id;
  END IF;
END $$;

-- ── service_engagements.linked_rider_ids -> linked_service_recipient_ids ──
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_engagements' AND column_name = 'linked_rider_ids') THEN
    ALTER TABLE public.service_engagements RENAME COLUMN linked_rider_ids TO linked_service_recipient_ids;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_engagements' AND column_name = 'linked_service_recipient_ids') THEN
    UPDATE public.service_engagements SET linked_service_recipient_ids = ARRAY(
      SELECT regexp_replace(x, '^RDR-', 'SR-') FROM unnest(linked_service_recipient_ids) AS x
    ) WHERE EXISTS (SELECT 1 FROM unnest(linked_service_recipient_ids) AS x WHERE x LIKE 'RDR-%');
  END IF;
END $$;

-- ── incidents (mock-only today — guarded in case a live table exists) ────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidents' AND column_name = 'linked_rider_ids') THEN
    ALTER TABLE public.incidents RENAME COLUMN linked_rider_ids TO linked_service_recipient_ids;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidents' AND column_name = 'linked_service_recipient_ids') THEN
    UPDATE public.incidents SET linked_service_recipient_ids = ARRAY(
      SELECT regexp_replace(x, '^RDR-', 'SR-') FROM unnest(linked_service_recipient_ids) AS x
    ) WHERE EXISTS (SELECT 1 FROM unnest(linked_service_recipient_ids) AS x WHERE x LIKE 'RDR-%');
  END IF;
END $$;
