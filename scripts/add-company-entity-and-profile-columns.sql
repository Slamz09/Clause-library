-- ============================================================
-- Company entity resolution + stable Company-profile attributes
-- (docs/ontology.md §7).
--
-- Confirmed gap (2026-08-23 audit): `contracts` identifies the counterparty
-- (linked_client_id/linked_vendor_id) but nothing identifies WHICH of
-- Consola's own `entities` rows is the actual contracting party — real,
-- not assumed. Settings -> Company (app/(app)/settings/company/page.tsx)
-- already manages `entities` as a proper multi-row table ("Your own business
-- entities"), so this column is what's missing to resolve "the applicable
-- Company entity" per contract, not a new concept.
--
-- Also adds the stable, broadly-reusable Company-profile attributes that
-- passed the docs/ontology.md §7 test (stable/slowly-changing legal-entity
-- characteristic -> real `entities` column; measured/evidenced/temporal ->
-- entity_facts instead, deliberately NOT added here). Jurisdictions
-- registered to do business and registration status by jurisdiction are
-- intentionally excluded from this file for that reason — they're
-- entity_facts rows once create-fact-layer.sql exists.
--
-- Independent of every other new file in this batch — can run anytime.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS company_entity_id TEXT REFERENCES public.entities(entity_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_company_entity_id ON public.contracts (company_entity_id);

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS for_profit_status          BOOLEAN,
  ADD COLUMN IF NOT EXISTS principal_place_of_business TEXT,
  ADD COLUMN IF NOT EXISTS industry                    TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_year_start_month      INTEGER;  -- 1-12; NULL = assume calendar year
-- entity_subtype (existing column) is reused for Legal Entity Type /
-- Organizational Form rather than adding a duplicate column — confirm this
-- covers the need before relying on it; if not, a follow-up column is a
-- one-line addition, not a redesign.
