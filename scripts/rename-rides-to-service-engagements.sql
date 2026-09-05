-- ============================================================
-- Rename rides -> service_engagements
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
--
-- "Ride" was transportation-specific terminology; the app now models this
-- entity as a general "Service Engagement" so the same platform can support
-- healthcare, security, field services, etc. This migration renames the
-- table/columns/indexes/policy in place (ALTER ... RENAME preserves all
-- existing rows/data — no drop/recreate), and re-points existing RDE-###
-- IDs to the new SE-### format, cascading that ID-value change into the
-- riders table's linked_service_engagement_ids array.
--
-- Run scripts/add-drivers-rides-riders-tables.sql first if this is a fresh
-- database — that script still describes the pre-rename schema as a
-- historical record and is not being edited.
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'rides') THEN
    ALTER TABLE public.rides RENAME TO service_engagements;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_engagements' AND column_name = 'ride_id') THEN
    ALTER TABLE public.service_engagements RENAME COLUMN ride_id TO service_engagement_id;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_engagements' AND column_name = 'ride_type') THEN
    ALTER TABLE public.service_engagements RENAME COLUMN ride_type TO service_engagement_type;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_engagements' AND column_name = 'ride_video_recorded') THEN
    ALTER TABLE public.service_engagements RENAME COLUMN ride_video_recorded TO video_recorded;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'riders' AND column_name = 'linked_ride_ids') THEN
    ALTER TABLE public.riders RENAME COLUMN linked_ride_ids TO linked_service_engagement_ids;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'drivers' AND column_name = 'assigned_rides_count') THEN
    ALTER TABLE public.drivers RENAME COLUMN assigned_rides_count TO assigned_service_engagements_count;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'total_rides_count') THEN
    ALTER TABLE public.customers RENAME COLUMN total_rides_count TO total_service_engagements_count;
  END IF;
END $$;

-- Keep index/policy names in sync with the renamed table (metadata-only, no data change)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'rides_customer_id') THEN
    ALTER INDEX public.rides_customer_id RENAME TO service_engagements_customer_id;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'rides_driver_id') THEN
    ALTER INDEX public.rides_driver_id RENAME TO service_engagements_driver_id;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'service_engagements' AND policyname = 'allow_all_rides') THEN
    ALTER POLICY allow_all_rides ON public.service_engagements RENAME TO allow_all_service_engagements;
  END IF;
END $$;

-- Re-point existing ID values from RDE-### to SE-### (idempotent — only touches unconverted rows)
UPDATE public.service_engagements
  SET service_engagement_id = regexp_replace(service_engagement_id, '^RDE-', 'SE-')
  WHERE service_engagement_id LIKE 'RDE-%';

UPDATE public.riders
  SET linked_service_engagement_ids = ARRAY(
    SELECT regexp_replace(x, '^RDE-', 'SE-') FROM unnest(linked_service_engagement_ids) AS x
  )
  WHERE EXISTS (SELECT 1 FROM unnest(linked_service_engagement_ids) AS x WHERE x LIKE 'RDE-%');
