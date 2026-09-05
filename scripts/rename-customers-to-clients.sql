-- ============================================================
-- Rename customers -> clients (and cascade into referencing columns)
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
--
-- "Customer" was renamed to "Client" platform-wide (labels, IDs, and
-- internal identifiers). This migration renames the live `customers` table
-- (there is no versioned CREATE TABLE script for it in this repo — see
-- docs/drivers-customers-operations-rides-schema.txt for why) and cascades
-- the column rename into every other table that references it. ALTER ...
-- RENAME preserves all existing data — no drop/recreate.
--
-- Existing IDs keep their CUST-### format (not re-pointed to CLI-### by
-- this script) — client_id values are opaque strings to the app, so this
-- is optional. Uncomment the UPDATE statements at the bottom if you want
-- existing rows to match newly-created CLI-### IDs.
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customers') THEN
    ALTER TABLE public.customers RENAME TO clients;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'customer_id') THEN
    ALTER TABLE public.clients RENAME COLUMN customer_id TO client_id;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'customer_name') THEN
    ALTER TABLE public.clients RENAME COLUMN customer_name TO client_name;
  END IF;
END $$;

-- ── Cascade into referencing tables ──────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'drivers' AND column_name = 'customer_id') THEN
    ALTER TABLE public.drivers RENAME COLUMN customer_id TO client_id;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_engagements' AND column_name = 'customer_id') THEN
    ALTER TABLE public.service_engagements RENAME COLUMN customer_id TO client_id;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_engagements' AND column_name = 'customer_name') THEN
    ALTER TABLE public.service_engagements RENAME COLUMN customer_name TO client_name;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'riders' AND column_name = 'customer_id') THEN
    ALTER TABLE public.riders RENAME COLUMN customer_id TO client_id;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'riders' AND column_name = 'customer_name') THEN
    ALTER TABLE public.riders RENAME COLUMN customer_name TO client_name;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = 'linked_customer_id') THEN
    ALTER TABLE public.contracts RENAME COLUMN linked_customer_id TO linked_client_id;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = 'linked_customer_name') THEN
    ALTER TABLE public.contracts RENAME COLUMN linked_customer_name TO linked_client_name;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = 'customer_specific_bgc_requirements') THEN
    ALTER TABLE public.contracts RENAME COLUMN customer_specific_bgc_requirements TO client_specific_bgc_requirements;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'insurance_policies' AND column_name = 'linked_customer_ids') THEN
    ALTER TABLE public.insurance_policies RENAME COLUMN linked_customer_ids TO linked_client_ids;
  END IF;
END $$;

-- incidents/complaints only exist as mock data today (no live table found in
-- this repo at time of writing) — guarded the same way in case that changes.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidents' AND column_name = 'linked_customer_id') THEN
    ALTER TABLE public.incidents RENAME COLUMN linked_customer_id TO linked_client_id;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'complaints' AND column_name = 'customer_ids') THEN
    ALTER TABLE public.complaints RENAME COLUMN customer_ids TO client_ids;
  END IF;
END $$;

-- ── Stored data VALUES that changed meaning, not just column names ──────
-- contracts.contract_facing: 'customer' -> 'client'
UPDATE public.contracts SET contract_facing = 'client' WHERE contract_facing = 'customer';

-- contracts.paper_source: 'Customer Paper' -> 'Client Paper'
UPDATE public.contracts SET paper_source = 'Client Paper' WHERE paper_source = 'Customer Paper';

-- customCounterpartyTypes / contracts.counterparty_type free-text tag, if any row used the literal default label
UPDATE public.contracts SET counterparty_type = 'Client' WHERE counterparty_type = 'Customer';

-- Keep RLS policy name in sync if it exists under the old naming convention
-- (metadata-only, no data change). No-ops if the policy was never created
-- under this name.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clients' AND policyname = 'allow_all_customers') THEN
    ALTER POLICY allow_all_customers ON public.clients RENAME TO allow_all_clients;
  END IF;
END $$;

-- ── Optional: re-point existing CUST-### IDs to CLI-### (uncomment to run) ──
-- UPDATE public.clients SET client_id = regexp_replace(client_id, '^CUST-', 'CLI-') WHERE client_id LIKE 'CUST-%';
-- UPDATE public.drivers SET client_id = regexp_replace(client_id, '^CUST-', 'CLI-') WHERE client_id LIKE 'CUST-%';
-- UPDATE public.service_engagements SET client_id = regexp_replace(client_id, '^CUST-', 'CLI-') WHERE client_id LIKE 'CUST-%';
-- UPDATE public.riders SET client_id = regexp_replace(client_id, '^CUST-', 'CLI-') WHERE client_id LIKE 'CUST-%';
-- UPDATE public.contracts SET linked_client_id = regexp_replace(linked_client_id, '^CUST-', 'CLI-') WHERE linked_client_id LIKE 'CUST-%';
