-- ============================================================
-- clients_serviced column on service_providers
-- Run once in Supabase SQL Editor. Non-destructive, safe to re-run.
--
-- Array of client_id values (from public.clients) the service provider is
-- manually linked to via the "Clients Serviced" column on the Service
-- Providers table. Entry is selection-only (search-existing-clients UI) —
-- this never holds a client name/id that doesn't correspond to a real
-- clients row. Nullable/empty for existing rows — nothing else changes.
-- ============================================================

ALTER TABLE public.service_providers ADD COLUMN IF NOT EXISTS clients_serviced TEXT[] DEFAULT '{}'::text[];
