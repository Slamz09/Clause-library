-- SUPERSEDED 2026-08-23 — never applied to the live database, and could not
-- have been: section 1 ALTERs public.contract_clauses, a table that does not
-- exist and is not created anywhere else in this migration history (the real
-- table is `clauses`). Section 2 also assumes `public.obligations` already
-- exists with a base column set (obligation_type/status/severity/document_id/
-- entity_id/asset_id) that add-obligations-table.sql's version never
-- actually included — the two draft migrations were mutually inconsistent
-- even on paper. The real, live-needed shape this section was reaching for
-- (source_document_id/source_clause_id/related_entity_id/related_asset_id/
-- confidence/etc.) is what app/(app)/documents/page.tsx's
-- autoSaveObligations + ObligationsTab actually construct today — now
-- captured correctly in scripts/create-saved-obligations-table.sql as its
-- own table, not a bolt-on to the extraction table. Section 4
-- (event_obligation_impacts) is unaffected by that and remains live/kept as
-- documented in docs/implementation-plan.md. Kept here for history only —
-- do not run this file.
--
-- ─── Obligations Architecture Schema ──────────────────────────────────────────
-- Evolves the existing obligations + events tables and adds event_obligation_impacts.
-- Safe to run on existing data — uses ADD COLUMN IF NOT EXISTS throughout.

-- ─── 1. Patch contract_clauses with new obligation-pipeline fields ─────────────
ALTER TABLE public.contract_clauses
  ADD COLUMN IF NOT EXISTS is_obligation_candidate BOOLEAN  DEFAULT false,
  ADD COLUMN IF NOT EXISTS obligation_confidence   NUMERIC,
  ADD COLUMN IF NOT EXISTS asset_id               TEXT;
-- source_text, clause_category, document_id, entity_id already exist per add-insurance-schema.sql

-- ─── 2. Evolve obligations table ──────────────────────────────────────────────
-- Existing PK: obligation_id TEXT
-- Add all new first-class obligation fields while keeping legacy columns intact.
ALTER TABLE public.obligations
  -- Source provenance
  ADD COLUMN IF NOT EXISTS source_document_id   TEXT,
  ADD COLUMN IF NOT EXISTS source_clause_id     TEXT,
  -- Classification
  ADD COLUMN IF NOT EXISTS obligation_subtype   TEXT,
  ADD COLUMN IF NOT EXISTS obligated_party_type TEXT,
  ADD COLUMN IF NOT EXISTS obligated_party_id   TEXT,
  ADD COLUMN IF NOT EXISTS obligated_party_text TEXT,
  -- Structured action fields
  ADD COLUMN IF NOT EXISTS action_text          TEXT,
  ADD COLUMN IF NOT EXISTS standard_text        TEXT,
  ADD COLUMN IF NOT EXISTS frequency_text       TEXT,
  ADD COLUMN IF NOT EXISTS deadline_text        TEXT,
  ADD COLUMN IF NOT EXISTS trigger_event_type   TEXT,
  -- Relationships
  ADD COLUMN IF NOT EXISTS related_entity_id    TEXT,
  ADD COLUMN IF NOT EXISTS related_asset_id     TEXT,
  ADD COLUMN IF NOT EXISTS regulator_id         TEXT,
  -- Metadata
  ADD COLUMN IF NOT EXISTS source_text          TEXT,
  ADD COLUMN IF NOT EXISTS confidence           NUMERIC,
  ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ DEFAULT NOW();
-- Note: obligation_type, status, severity, document_id, entity_id, asset_id already exist

-- ─── 3. Evolve events table ───────────────────────────────────────────────────
-- Existing PK: event_id TEXT
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS occurred_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS summary      TEXT,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();
-- Note: event_type, entity_id, asset_id, event_date, status, severity, notes already exist

-- ─── 4. event_obligation_impacts — supersedes obligation_matches ───────────────
-- obligation_matches is kept for backward compat; this new table uses the richer model.
CREATE TABLE IF NOT EXISTS public.event_obligation_impacts (
  id             TEXT PRIMARY KEY DEFAULT 'eoi_' || substr(md5(random()::text), 1, 12),
  event_id       TEXT NOT NULL,
  obligation_id  TEXT NOT NULL,
  impact_type    TEXT NOT NULL,
  -- triggered | potentially_breached | satisfied | tested | under_review
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (event_id, obligation_id)
);

-- ─── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.event_obligation_impacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_event_obligation_impacts"
  ON public.event_obligation_impacts FOR ALL TO anon, service_role USING (true) WITH CHECK (true);

-- ─── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS obligations_source_clause_id    ON public.obligations (source_clause_id);
CREATE INDEX IF NOT EXISTS obligations_source_document_id  ON public.obligations (source_document_id);
CREATE INDEX IF NOT EXISTS obligations_related_entity_id   ON public.obligations (related_entity_id);
CREATE INDEX IF NOT EXISTS obligations_related_asset_id    ON public.obligations (related_asset_id);
CREATE INDEX IF NOT EXISTS eoi_event_id                    ON public.event_obligation_impacts (event_id);
CREATE INDEX IF NOT EXISTS eoi_obligation_id               ON public.event_obligation_impacts (obligation_id);
