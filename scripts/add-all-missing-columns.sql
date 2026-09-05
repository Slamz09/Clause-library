-- ============================================================
-- Consola 360 — Catch-up Migration
-- Run this ONCE in Supabase SQL Editor to add all missing
-- tables and columns. Uses IF NOT EXISTS throughout — safe
-- to re-run on a DB that already has some of these.
-- ============================================================

-- ── 1. documents table extras ─────────────────────────────
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS file_text        TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS entity_name      TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS governing_state  TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS parent_doc_id   TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS doc_relation     TEXT;

-- ── 2. obligations extras (source tracing) ────────────────
ALTER TABLE public.obligations ADD COLUMN IF NOT EXISTS source_clause_id     TEXT;
ALTER TABLE public.obligations ADD COLUMN IF NOT EXISTS source_document_id   TEXT;
ALTER TABLE public.obligations ADD COLUMN IF NOT EXISTS related_entity_id    TEXT;
ALTER TABLE public.obligations ADD COLUMN IF NOT EXISTS related_asset_id     TEXT;
ALTER TABLE public.obligations ADD COLUMN IF NOT EXISTS obligated_party_type TEXT;
ALTER TABLE public.obligations ADD COLUMN IF NOT EXISTS obligated_party_id   TEXT;
ALTER TABLE public.obligations ADD COLUMN IF NOT EXISTS obligated_party_text TEXT;
ALTER TABLE public.obligations ADD COLUMN IF NOT EXISTS action_text          TEXT;
ALTER TABLE public.obligations ADD COLUMN IF NOT EXISTS standard_text        TEXT;
ALTER TABLE public.obligations ADD COLUMN IF NOT EXISTS frequency_text       TEXT;
ALTER TABLE public.obligations ADD COLUMN IF NOT EXISTS deadline_text        TEXT;
ALTER TABLE public.obligations ADD COLUMN IF NOT EXISTS trigger_event_type   TEXT;
ALTER TABLE public.obligations ADD COLUMN IF NOT EXISTS source_text          TEXT;
ALTER TABLE public.obligations ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS obligations_source_clause_id   ON public.obligations (source_clause_id);
CREATE INDEX IF NOT EXISTS obligations_related_entity_id  ON public.obligations (related_entity_id);
CREATE INDEX IF NOT EXISTS obligations_related_asset_id   ON public.obligations (related_asset_id);

-- ── 3. assets extras ──────────────────────────────────────
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS no_employees INTEGER;

-- ── 4. entity_governance table (1:1 with entity) ─────────
CREATE TABLE IF NOT EXISTS public.entity_governance (
  entity_id                TEXT PRIMARY KEY REFERENCES public.entities(entity_id) ON DELETE CASCADE,
  good_standing            BOOLEAN,
  good_standing_as_of      DATE,
  annual_report_due_date   DATE,
  annual_report_last_filed DATE,
  registered_agent         TEXT,
  notes                    TEXT,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.entity_governance ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'entity_governance' AND policyname = 'allow_all_entity_governance'
  ) THEN
    CREATE POLICY "allow_all_entity_governance"
      ON public.entity_governance FOR ALL TO anon, service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 5. entity_permits table (1:N with entity) ─────────────
CREATE TABLE IF NOT EXISTS public.entity_permits (
  id                TEXT PRIMARY KEY,
  entity_id         TEXT NOT NULL REFERENCES public.entities(entity_id) ON DELETE CASCADE,
  permit_type       TEXT NOT NULL,
  permit_name       TEXT,
  permit_number     TEXT,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','expired','suspended','revoked','pending')),
  issued_date       DATE,
  expiration_date   DATE,
  issuing_authority TEXT,
  jurisdiction      TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entity_permits_entity_id ON public.entity_permits (entity_id);

ALTER TABLE public.entity_permits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'entity_permits' AND policyname = 'allow_all_entity_permits'
  ) THEN
    CREATE POLICY "allow_all_entity_permits"
      ON public.entity_permits FOR ALL TO anon, service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 6. events extras ──────────────────────────────────────
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS summary     TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();
