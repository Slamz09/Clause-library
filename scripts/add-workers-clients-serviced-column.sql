-- ============================================================
-- clients_serviced column on workers
-- Run once in Supabase SQL Editor. Non-destructive, safe to re-run.
--
-- Array of client_id values (from public.clients) a worker is manually
-- linked to via the "Clients Serviced" column on the Workers table —
-- selection-only (search-existing-clients UI), never a free-text name.
--
-- This is a MANUAL supplement to the automatic worker→client derivation from
-- Operations → Service Engagements (lib/mockData.ts
-- workerServiceEngagementClientIds). Per-obligation applicability
-- (lib/obligations/applicabilityBuilder.ts) unions all three sources:
-- workers.customer_id, workers.clients_serviced, and service_engagements.
-- ============================================================

ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS clients_serviced TEXT[] DEFAULT '{}'::text[];
