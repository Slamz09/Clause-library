-- ============================================================================
-- setup-standalone.sql — one-paste schema for the standalone Clause Library /
-- Document Parser build.
--
-- Consolidates scripts/schema.sql + the clause/document/obligation migrations
-- into a single idempotent script covering exactly the tables this app's
-- parser + clause-library surface reads and writes:
--
--   documents         — one row per uploaded document
--   clauses           — extracted + classified provisions
--   clause_units      — atomic sub-units of a clause (deep extraction)
--   document_uploads  — per-file upload / extraction job record
--   saved_obligations — clauses a user saved as obligations
--   obligations       — normalized monitorable duties (deep extraction)
--
-- Plus a public Storage bucket named `documents` for the original files.
--
-- Safe to re-run: every statement is CREATE ... IF NOT EXISTS /
-- ADD COLUMN IF NOT EXISTS / DROP POLICY IF EXISTS + CREATE POLICY.
--
-- RLS: enabled on every table with a permissive allow-all policy. The server
-- routes use a service_role client (which bypasses RLS entirely); the
-- permissive policy is only so the anon/authenticated client can read where
-- the app expects to. Tighten later if this stops being single-tenant.
--
-- Run in: Supabase dashboard → SQL Editor → new query → paste → Run.
-- ============================================================================

-- ─── documents ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.documents (
  document_id       TEXT PRIMARY KEY,
  title             TEXT,
  document_type     TEXT,
  document_subtype  TEXT,
  entity_id         TEXT,
  asset_id          TEXT,
  counterparty_name TEXT,
  effective_date    DATE,
  expiration_date   DATE,
  status            TEXT DEFAULT 'active',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS file_text                          TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS entity_name                        TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS parent_doc_id                      TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS doc_relation                       TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS doc_timeline                       JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS governing_state                    TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS party_position                     TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS compliance_score                   NUMERIC(4,1);
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS extraction_mode                    TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS deep_extracted_at                  TIMESTAMPTZ;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS document_type_confidence           NUMERIC;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS document_type_classification_method TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS system_document_type               TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS system_document_type_confidence    NUMERIC;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS system_document_type_method        TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS document_type_override             TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS document_type_override_by          TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS document_type_override_at          TIMESTAMPTZ;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS paper_source_guess                 TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS paper_source_confidence            NUMERIC;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS matched_template_id                TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS matched_template_name              TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS matched_template_confidence        NUMERIC;

CREATE INDEX IF NOT EXISTS idx_documents_extraction_mode ON public.documents (extraction_mode);

-- ─── clauses ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clauses (
  clause_id          TEXT PRIMARY KEY,
  document_id        TEXT,
  contract_family_id TEXT,
  clause_no          TEXT,
  clause_type        TEXT,
  clause_text        TEXT,
  subtags            TEXT[],
  obligation_type    TEXT,
  ai_classification  TEXT,
  ai_confidence      NUMERIC,
  affiliates_bound   TEXT[],
  review_status      TEXT DEFAULT 'pending',
  complexity_score   NUMERIC,
  balance_score      NUMERIC,
  source_page        INTEGER,
  char_start         INTEGER,
  char_end           INTEGER,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS clause_name          TEXT;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS detected_type        TEXT;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS normalized_summary   TEXT;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS entity_name          TEXT;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS counterparty_name    TEXT;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS insurer_vendor_id    TEXT;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS regulatory_source_id TEXT;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS paper_source         TEXT;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS survives_termination BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS approval_needed      TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS approval_details     JSONB;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS version_no           TEXT;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS category             TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS modifiers            TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS compliance_status    TEXT DEFAULT 'unchecked';
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS compliance_notes     TEXT;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS compliance_score     INTEGER;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS playbook_id          TEXT;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS red_flag_hits        TEXT[];
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS risk_level           TEXT DEFAULT 'low';
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS rules_score          INTEGER;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS parent_clause_id     TEXT;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS clause_depth         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS clause_path          TEXT;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS section_heading      TEXT;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS structural_labels    TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS topic_labels         TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS unit_count           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS obligation_count     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS has_units            BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS extraction_mode      TEXT NOT NULL DEFAULT 'standard';

CREATE INDEX IF NOT EXISTS idx_clauses_document_id     ON public.clauses (document_id);
CREATE INDEX IF NOT EXISTS idx_clauses_parent_clause   ON public.clauses (parent_clause_id);
CREATE INDEX IF NOT EXISTS idx_clauses_compliance      ON public.clauses (compliance_status);

-- ─── clause_units ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clause_units (
  clause_unit_id        TEXT PRIMARY KEY,
  clause_id             TEXT NOT NULL REFERENCES public.clauses(clause_id) ON DELETE CASCADE,
  document_id           TEXT NOT NULL REFERENCES public.documents(document_id) ON DELETE CASCADE,
  unit_index            INTEGER NOT NULL,
  parent_unit_id        TEXT NULL REFERENCES public.clause_units(clause_unit_id) ON DELETE CASCADE,
  unit_text             TEXT NOT NULL,
  unit_text_normalized  TEXT NULL,
  structural_labels     TEXT[] NOT NULL DEFAULT '{}',
  topic_labels          TEXT[] NOT NULL DEFAULT '{}',
  actor                 TEXT NULL,
  beneficiary           TEXT NULL,
  defined_term          TEXT NULL,
  definition_type       TEXT NULL,
  trigger_text          TEXT NULL,
  action_text           TEXT NULL,
  object_text           TEXT NULL,
  qualifier_text        TEXT NULL,
  exception_text        TEXT NULL,
  deadline_text         TEXT NULL,
  frequency_text        TEXT NULL,
  source_page           INTEGER NULL,
  char_start            INTEGER NULL,
  char_end              INTEGER NULL,
  extraction_method     TEXT NOT NULL DEFAULT 'llm',
  extraction_confidence NUMERIC NULL,
  structure_confidence  NUMERIC NULL,
  topic_confidence      NUMERIC NULL,
  needs_review          BOOLEAN NOT NULL DEFAULT false,
  review_reason         TEXT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clause_units_clause_id   ON public.clause_units (clause_id);
CREATE INDEX IF NOT EXISTS idx_clause_units_document_id ON public.clause_units (document_id);
CREATE INDEX IF NOT EXISTS idx_clause_units_parent      ON public.clause_units (parent_unit_id);

-- ─── document_uploads ──────────────────────────────────────────────────────
-- (No CREATE for this table exists in scripts/ — it predates the extracted
-- migration history. Authored here from the columns the code reads/writes:
-- lib/documents/processDocumentUpload.ts, app/api/documents/uploads/route.ts,
-- scripts/add-bulk-upload-schema.sql.)
CREATE TABLE IF NOT EXISTS public.document_uploads (
  upload_id         TEXT PRIMARY KEY,
  document_id       TEXT,
  file_name         TEXT,
  file_type         TEXT,
  document_type     TEXT,
  extraction_status TEXT,
  extracted_count   INTEGER,
  file_text         TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.document_uploads ADD COLUMN IF NOT EXISTS batch_id      TEXT;
ALTER TABLE public.document_uploads ADD COLUMN IF NOT EXISTS retry_count   INT NOT NULL DEFAULT 0;
ALTER TABLE public.document_uploads ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE public.document_uploads ADD COLUMN IF NOT EXISTS started_at    TIMESTAMPTZ;
ALTER TABLE public.document_uploads ADD COLUMN IF NOT EXISTS finished_at   TIMESTAMPTZ;
ALTER TABLE public.document_uploads ADD COLUMN IF NOT EXISTS upload_meta   JSONB;

CREATE INDEX IF NOT EXISTS idx_document_uploads_document_id ON public.document_uploads (document_id);
CREATE INDEX IF NOT EXISTS idx_document_uploads_batch_id    ON public.document_uploads (batch_id);

-- ─── saved_obligations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saved_obligations (
  obligation_id      TEXT PRIMARY KEY,
  status             TEXT NOT NULL DEFAULT 'active',
  source_document_id TEXT NULL,
  document_id        TEXT NULL,
  source_clause_id   TEXT NULL,
  obligation_type    TEXT NULL,
  action_text        TEXT NULL,
  source_text        TEXT NULL,
  confidence         NUMERIC NULL,
  entity_id          TEXT NULL,
  related_entity_id  TEXT NULL,
  asset_id           TEXT NULL,
  related_asset_id   TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_obligations_document_id        ON public.saved_obligations (document_id);
CREATE INDEX IF NOT EXISTS idx_saved_obligations_source_document_id ON public.saved_obligations (source_document_id);
CREATE INDEX IF NOT EXISTS idx_saved_obligations_source_clause_id   ON public.saved_obligations (source_clause_id);
CREATE INDEX IF NOT EXISTS idx_saved_obligations_status             ON public.saved_obligations (status);
CREATE INDEX IF NOT EXISTS idx_saved_obligations_type               ON public.saved_obligations (obligation_type);

-- ─── obligations (deep extraction) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.obligations (
  obligation_id         TEXT PRIMARY KEY,
  clause_unit_id        TEXT NULL REFERENCES public.clause_units(clause_unit_id) ON DELETE SET NULL,
  clause_id             TEXT NOT NULL REFERENCES public.clauses(clause_id) ON DELETE CASCADE,
  document_id           TEXT NOT NULL REFERENCES public.documents(document_id) ON DELETE CASCADE,
  obligation_kind       TEXT NOT NULL,
  actor                 TEXT NULL,
  beneficiary           TEXT NULL,
  action_text           TEXT NOT NULL,
  object_text           TEXT NULL,
  trigger_text          TEXT NULL,
  deadline_text         TEXT NULL,
  frequency_text        TEXT NULL,
  qualifier_text        TEXT NULL,
  exception_text        TEXT NULL,
  topic_labels          TEXT[] NOT NULL DEFAULT '{}',
  canonical_clause_type TEXT NULL,
  is_conditional        BOOLEAN NOT NULL DEFAULT false,
  condition_text        TEXT NULL,
  monetary_amount       NUMERIC NULL,
  monetary_currency     TEXT NULL DEFAULT 'USD',
  time_period_days      INTEGER NULL,
  evidence_hint         TEXT NULL,
  monitor_flag          BOOLEAN NOT NULL DEFAULT false,
  needs_review          BOOLEAN NOT NULL DEFAULT false,
  review_reason         TEXT NULL,
  status                TEXT NOT NULL DEFAULT 'active',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obligations_clause_id      ON public.obligations (clause_id);
CREATE INDEX IF NOT EXISTS idx_obligations_document_id    ON public.obligations (document_id);
CREATE INDEX IF NOT EXISTS idx_obligations_clause_unit_id ON public.obligations (clause_unit_id);
CREATE INDEX IF NOT EXISTS idx_obligations_status         ON public.obligations (status);

-- ─── Row-level security: enable + permissive allow-all ─────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'documents', 'clauses', 'clause_units', 'document_uploads',
    'saved_obligations', 'obligations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_allow_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true)',
      t || '_allow_all', t
    );
  END LOOP;
END $$;

-- ─── Storage bucket for the original document files ────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "documents_bucket_all" ON storage.objects;
CREATE POLICY "documents_bucket_all" ON storage.objects
  FOR ALL TO anon, authenticated, service_role
  USING (bucket_id = 'documents')
  WITH CHECK (bucket_id = 'documents');

-- ============================================================================
-- Done. Tables: documents, clauses, clause_units, document_uploads,
-- saved_obligations, obligations. Storage bucket: documents (public).
--
-- Not included (parent-platform features the standalone app degrades on
-- gracefully — the routes catch the "relation does not exist" error):
-- contracts, clients, service_providers, entities, insurance_policies,
-- playbooks, and the canonical_obligation* applicability tables.
-- ============================================================================
