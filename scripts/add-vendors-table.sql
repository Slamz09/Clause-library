-- ============================================================
-- Vendors table + contracts table additions
-- Run once in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- Vendors master table
CREATE TABLE IF NOT EXISTS public.vendors (
  vendor_id     TEXT PRIMARY KEY,          -- format: VEND-001
  vendor_name   TEXT NOT NULL,
  contact_name  TEXT,
  contact_email TEXT,
  website       TEXT,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vendors' AND policyname='allow_all_vendors') THEN
    CREATE POLICY "allow_all_vendors" ON public.vendors FOR ALL TO anon, service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS vendors_vendor_name ON public.vendors (vendor_name);

-- Extend contracts table for customer/vendor facing
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS contract_facing  TEXT DEFAULT 'customer'; -- 'customer' | 'vendor'
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS linked_vendor_id   TEXT;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS linked_vendor_name TEXT;
