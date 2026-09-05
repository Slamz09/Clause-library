-- ============================================================
-- Regulatory identity/version layer + provision linkage + obligation
-- topic taxonomy (docs/ontology.md §7).
--
-- regulatory_sources = the structured legal identity/version, NOT the
-- document artifact and NOT a topic bucket. A statute PDF is a `documents`
-- row; the law it represents is a `regulatory_sources` row.
--
-- Run order: 1st of the new regulatory/canonical batch (independent of
-- fact_definitions/entity_facts and canonical_obligations, but those depend
-- on this file's tables — run this before create-fact-layer.sql,
-- create-regulatory-applicability-engine.sql, and
-- create-canonical-obligations-full.sql).
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.regulatory_sources (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction                TEXT,
  jurisdiction_level          TEXT DEFAULT 'state',   -- 'state' | 'federal' | 'county' | 'city'
  authority                   TEXT,
  citation                    TEXT,
  title                       TEXT,
  summary                     TEXT,
  -- Compatibility bridge: preserves existing IDs like 'CO-001' from
  -- lib/regulationData.ts's DRIVER_REQ_DATA so legalBgcId()/decision_traces
  -- citations keep resolving unchanged once Stage 2 of the migration (see
  -- docs/ontology.md §7) switches lookups from the static array to this
  -- table. Not populated by this migration — seeding is a separate step.
  legal_id                    TEXT UNIQUE,
  primary_source_document_id  TEXT REFERENCES public.documents(document_id) ON DELETE SET NULL,
  external_source_uri         TEXT,   -- authoritative URL/API/dataset reference when not document-backed
  effective_from              DATE,
  effective_until             DATE,
  supersedes_id                UUID REFERENCES public.regulatory_sources(id),
  superseded_by_id             UUID REFERENCES public.regulatory_sources(id),
  status                       TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'superseded' | 'needs_review'
  match_method                 TEXT,   -- 'exact_citation' | 'normalized_identity' | 'manual_link' | 'seed_data'
  potential_duplicate_of       UUID REFERENCES public.regulatory_sources(id),
  extraction_confidence         NUMERIC,
  field_confidence              JSONB,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_regulatory_sources_jurisdiction ON public.regulatory_sources (jurisdiction);
CREATE INDEX IF NOT EXISTS idx_regulatory_sources_legal_id     ON public.regulatory_sources (legal_id);
CREATE INDEX IF NOT EXISTS idx_regulatory_sources_status       ON public.regulatory_sources (status);

-- Only for >1 authoritative artifact of the SAME legal version (e.g. an
-- agency-published companion PDF). A legal amendment that changes the
-- operative law is a NEW regulatory_sources row linked via
-- supersedes_id/superseded_by_id, not another row here.
CREATE TABLE IF NOT EXISTS public.regulatory_source_documents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  regulatory_source_id UUID NOT NULL REFERENCES public.regulatory_sources(id) ON DELETE CASCADE,
  document_id          TEXT NOT NULL REFERENCES public.documents(document_id) ON DELETE CASCADE,
  document_role        TEXT NOT NULL DEFAULT 'primary',  -- 'primary' | 'amendment_support' | 'agency_guidance' | 'translation' | 'other'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (regulatory_source_id, document_id)
);

-- Provisions reuse `clauses` — already document_id-scoped, already carries
-- source_page/char_start/char_end and PDF-viewer provenance (confirmed live
-- and working for non-contract sources during the 2026-08-23 audit).
-- Many clauses -> one regulatory_source (a statute has many provisions).
ALTER TABLE public.clauses
  ADD COLUMN IF NOT EXISTS regulatory_source_id UUID REFERENCES public.regulatory_sources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clauses_regulatory_source_id ON public.clauses (regulatory_source_id);

-- Source-neutral obligation topic taxonomy (docs/ontology.md §7 / §11 of the
-- final design). Separate from the existing contract-flavored
-- CANONICAL_CLAUSE_TYPES (lib/clauseTypes.ts) — that taxonomy is preserved
-- unchanged for existing consumers; this is the vocabulary
-- canonical_obligations.topic_id and regulatory provisions use.
CREATE TABLE IF NOT EXISTS public.obligation_topic_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_key       TEXT NOT NULL UNIQUE,   -- e.g. 'background_screening'
  label           TEXT NOT NULL,          -- e.g. 'Background Screening'
  description     TEXT,
  parent_topic_id UUID REFERENCES public.obligation_topic_definitions(id),
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A provision may cover more than one topic (one statute section can address
-- both background-check requirements and worker eligibility, for example).
CREATE TABLE IF NOT EXISTS public.clause_obligation_topics (
  clause_id TEXT NOT NULL REFERENCES public.clauses(clause_id) ON DELETE CASCADE,
  topic_id  UUID NOT NULL REFERENCES public.obligation_topic_definitions(id) ON DELETE CASCADE,
  PRIMARY KEY (clause_id, topic_id)
);

ALTER TABLE public.regulatory_sources         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regulatory_source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obligation_topic_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clause_obligation_topics     ENABLE ROW LEVEL SECURITY;
-- No policies granted on any of the four — default-deny for anon/authenticated
-- roles, service_role only, matching every table created this session
-- (compliance_evaluation_log, decision_traces, obligations, saved_obligations).
