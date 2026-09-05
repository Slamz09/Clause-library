-- ============================================================
-- Fact layer: fact_definitions + entity_facts (docs/ontology.md §7).
--
-- Documents don't only produce obligations — some establish facts needed to
-- determine whether another legal or contractual obligation applies (an
-- annual revenue statement, a business registration certificate, a
-- professional license). fact_definitions describes what a factual concept
-- MEANS (type, unit, how to ask a human about it); entity_facts is one
-- specific factual assertion about one specific entity for one specific
-- period, with provenance.
--
-- Independent of create-regulatory-sources.sql (only depends on `documents`,
-- which already exists) — can run before or after it, but must run before
-- create-regulatory-applicability-engine.sql, which references both.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.fact_definitions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_key                    TEXT NOT NULL UNIQUE,   -- stable machine key, e.g. 'annual_gross_revenue'
  fact_label                  TEXT NOT NULL,
  description                 TEXT,
  applicable_entity_types     TEXT[] NOT NULL DEFAULT '{}',  -- subset of company/client/worker/service_provider
  data_type                   TEXT NOT NULL,   -- 'currency'|'number'|'boolean'|'date'|'text'|'enum'|'percentage'|'jurisdiction'
  unit_type                   TEXT,            -- 'USD'|'persons'|'records'|'percent'|'months'|'years'|NULL
  requires_reporting_period   BOOLEAN NOT NULL DEFAULT false,
  requires_effective_period   BOOLEAN NOT NULL DEFAULT false,
  question_template           TEXT,            -- e.g. "What was {entity_name}'s gross annual revenue for {reporting_period}?"
  help_text                   TEXT,
  allowed_values               JSONB,           -- for enum-type facts
  validation_rules             JSONB,
  sensitivity_classification    TEXT,
  -- Whether this fact should normally be requested at entity-creation time
  -- (Settings onboarding), only when an applicability rule needs it, or
  -- either — see docs/ontology.md §7 "Settings onboarding vs. conditional
  -- questions." Do not build an onboarding questionnaire covering every
  -- possible statute; only 'onboarding'/'either' facts belong there.
  collection_mode               TEXT NOT NULL DEFAULT 'conditional',  -- 'onboarding' | 'conditional' | 'either'
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fact_definitions_fact_key ON public.fact_definitions (fact_key);

CREATE TABLE IF NOT EXISTS public.entity_facts (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type               TEXT NOT NULL,   -- 'company' | 'client' | 'worker' | 'service_provider'
  -- The real FK into entities/clients/workers/service_providers (typed by
  -- entity_type — no single Postgres FK constraint can span all four target
  -- tables, so this is validated at the application layer, same pattern
  -- already used by canonical_obligation_sources/canonical_obligation_applicability
  -- below). NEVER null merely to mean "our company" — every company-level
  -- fact must resolve to a real entities.entity_id.
  entity_id                  TEXT NOT NULL,
  fact_definition_id          UUID NOT NULL REFERENCES public.fact_definitions(id),
  value                        JSONB NOT NULL,
  unit                         TEXT,
  -- Scopes a fact to one jurisdiction when the fact itself is
  -- jurisdiction-specific (e.g. business-registration status varies by
  -- state) — distinct from the entity's own home jurisdiction.
  jurisdiction                 TEXT,
  effective_from                DATE,
  effective_until               DATE,
  reporting_period_start         DATE,
  reporting_period_end           DATE,
  source_document_id             TEXT REFERENCES public.documents(document_id) ON DELETE SET NULL,
  source_page                     INTEGER,
  source_location                  TEXT,
  source_system                    TEXT,   -- 'manual_user_entry' | 'document_extraction' | 'salesforce' | ...
  extraction_confidence             NUMERIC,
  verification_status                TEXT NOT NULL DEFAULT 'unverified',
    -- 'unverified' | 'machine_extracted' | 'human_confirmed' | 'system_verified' | 'disputed' | 'superseded'
  verified_by                          TEXT,
  verified_at                          TIMESTAMPTZ,
  created_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_facts_entity          ON public.entity_facts (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_facts_fact_definition  ON public.entity_facts (fact_definition_id);
CREATE INDEX IF NOT EXISTS idx_entity_facts_reporting_period  ON public.entity_facts (reporting_period_start, reporting_period_end);
CREATE INDEX IF NOT EXISTS idx_entity_facts_verification      ON public.entity_facts (verification_status);

ALTER TABLE public.fact_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_facts     ENABLE ROW LEVEL SECURITY;
-- No policies granted — default-deny, service_role only (see
-- create-regulatory-sources.sql for the full rationale, unchanged here).
