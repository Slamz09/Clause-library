-- ============================================================
-- Drivers, Rides, and Riders tables
-- Run once in Supabase SQL Editor. Safe to re-run.
--
-- Previously these entities only lived in browser localStorage
-- (consola_drivers / consola_rides / consola_riders) — no table, no API
-- route, so data added through the Drivers tab, Operations page, or the
-- Riders section of the Customers page never left the browser it was
-- entered in. This gives them a real home, matching the flat TEXT-PK
-- convention already used by vendors/customers (not the workspace-scoped
-- uuid schema in scripts/migrations/001_phase1_schema.sql, which isn't
-- what the live CRUD routes actually query).
-- ============================================================

-- Drivers
CREATE TABLE IF NOT EXISTS public.drivers (
  driver_id             TEXT PRIMARY KEY,          -- format: DRV-001
  start_date            TEXT,
  bgc_status            TEXT NOT NULL DEFAULT 'missing', -- 'complete' | 'expiring_soon' | 'missing'
  bgc_type              TEXT,
  first_bgc_date        TEXT,
  last_bgc_date         TEXT,
  bgc_duration          TEXT,
  assigned_rides_count  INTEGER NOT NULL DEFAULT 0,
  linked_incidents      TEXT[] NOT NULL DEFAULT '{}',
  linked_complaints     TEXT[] NOT NULL DEFAULT '{}',
  customer_id           TEXT,
  state                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='drivers' AND policyname='allow_all_drivers') THEN
    CREATE POLICY "allow_all_drivers" ON public.drivers FOR ALL TO anon, service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS drivers_customer_id ON public.drivers (customer_id);

-- Riders
CREATE TABLE IF NOT EXISTS public.riders (
  rider_id              TEXT PRIMARY KEY,          -- format: RDR-001
  video_consent_status  TEXT NOT NULL DEFAULT 'opt-in', -- 'opt-in' | 'opt-out'
  linked_ride_ids       TEXT[] NOT NULL DEFAULT '{}',
  customer_id           TEXT,
  customer_name         TEXT,
  state                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='riders' AND policyname='allow_all_riders') THEN
    CREATE POLICY "allow_all_riders" ON public.riders FOR ALL TO anon, service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS riders_customer_id ON public.riders (customer_id);

-- Rides
CREATE TABLE IF NOT EXISTS public.rides (
  ride_id                 TEXT PRIMARY KEY,          -- format: RDE-001
  date                    TEXT,
  ride_type               TEXT NOT NULL DEFAULT 'Single', -- 'Single' | 'Pooled'
  driver_id               TEXT,
  customer_name           TEXT,
  customer_id             TEXT,
  state                   TEXT,
  city                    TEXT,
  ride_video_recorded     BOOLEAN NOT NULL DEFAULT false,
  linked_rider_ids        TEXT[] NOT NULL DEFAULT '{}',
  linked_safety_incidents TEXT[] NOT NULL DEFAULT '{}',
  linked_complaints       TEXT[] NOT NULL DEFAULT '{}',
  vendor_id               TEXT,
  vendor_name             TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rides' AND policyname='allow_all_rides') THEN
    CREATE POLICY "allow_all_rides" ON public.rides FOR ALL TO anon, service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS rides_customer_id ON public.rides (customer_id);
CREATE INDEX IF NOT EXISTS rides_driver_id   ON public.rides (driver_id);
