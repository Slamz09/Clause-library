-- ============================================================
-- Canonical obligation layer (docs/ontology.md §7).
--
-- canonical_obligations is the resolved requirement/standard the Compliance
-- Engine actually evaluates — one table, all source types (contract, order
-- form, insurance, regulation, policy, other), distinguished by source_type,
-- not separate object types per source. Individual source requirements
-- (contract clauses, regulatory provisions, saved/extracted obligations)
-- remain independently preserved and citable via canonical_obligation_sources
-- — this table never stores a single authoritative "controlling_standard"
-- label; which source(s) control is recorded per-row on
-- canonical_obligation_sources.resolution_role (more than one row may be
-- 'controlling' when sources jointly establish the resolved standard).
--
-- Depends on: create-regulatory-sources.sql (obligation_topic_definitions,
-- regulatory_sources) and the live `documents`/`clauses`/`clients`/
-- `service_providers`/`workers` tables. Run this file AFTER
-- create-regulatory-sources.sql.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.canonical_obligations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type           TEXT NOT NULL,   -- 'contract'|'order_form'|'insurance'|'regulation'|'policy'|'other'
                                           -- primary/originating classification ONLY — not complete provenance,
                                           -- see canonical_obligation_sources for that.
  topic_id               UUID REFERENCES public.obligation_topic_definitions(id),
  requirement_summary     TEXT,
  requirement_terms        JSONB,          -- structured action/trigger/deadline/frequency where available
  -- Extensible string drawing on the Role vocabulary (docs/ontology.md §1:
  -- Client/ServiceProvider/Worker/Vendor/Subcontractor/Insurer/Company) —
  -- deliberately not a hardcoded CHECK-constrained enum, so new roles don't
  -- require a schema change.
  obligated_role           TEXT,
  flow_down_required        BOOLEAN NOT NULL DEFAULT false,
  -- Never 'controlling' — the canonical row IS the resolved standard;
  -- "controlling" describes underlying sources (canonical_obligation_sources.resolution_role).
  resolution_status          TEXT NOT NULL DEFAULT 'unresolved',
    -- 'resolved' | 'needs_review' | 'unresolved' | 'superseded'
  superseded_by                UUID REFERENCES public.canonical_obligations(id),
    -- Canonical VERSION history only (e.g. a 2027 cadence change superseding
    -- a 2026 one) — never used to express that a regulation supersedes a
    -- contract clause; that's a canonical_obligation_sources concern.
  confidence                     NUMERIC,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canonical_obligations_topic  ON public.canonical_obligations (topic_id);
CREATE INDEX IF NOT EXISTS idx_canonical_obligations_status ON public.canonical_obligations (resolution_status);

-- Many:many — one canonical obligation may have multiple independently
-- citable sources (an MSA clause, an Order Form clause, a regulatory
-- provision, a policy clause can all support one resolved requirement).
CREATE TABLE IF NOT EXISTS public.canonical_obligation_sources (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_obligation_id  UUID NOT NULL REFERENCES public.canonical_obligations(id) ON DELETE CASCADE,
  document_id               TEXT REFERENCES public.documents(document_id) ON DELETE SET NULL,
  clause_id                  TEXT REFERENCES public.clauses(clause_id) ON DELETE SET NULL,
  regulatory_source_id        UUID REFERENCES public.regulatory_sources(id) ON DELETE SET NULL,
  provenance_role              TEXT NOT NULL,  -- 'originating' | 'supporting' | 'manually_added' | 'extracted'
  -- Separate axis from provenance_role — multiple rows for the same
  -- canonical_obligation_id may carry resolution_role='controlling' at once;
  -- that IS how joint/cumulative control is represented (e.g. a regulation
  -- establishing screening modality + a contract independently establishing
  -- cadence, both controlling, together forming "annual fingerprint screening").
  resolution_role               TEXT NOT NULL,
    -- 'controlling' | 'supplemental' | 'superseded' | 'conflicting' | 'satisfied_by' | 'needs_review'
  resolution_reason               TEXT,   -- why this source controls/supplements, for the "why does this apply" UI
  -- Migration lineage ONLY (obligations/saved_obligations/extracted_obligations
  -- row this canonical row traces back to) — never the permanent authoritative
  -- provenance model. document_id/clause_id/regulatory_source_id above are.
  lineage_raw_table                TEXT,
  lineage_raw_id                    TEXT,
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canonical_obl_sources_obligation ON public.canonical_obligation_sources (canonical_obligation_id);
CREATE INDEX IF NOT EXISTS idx_canonical_obl_sources_clause     ON public.canonical_obligation_sources (clause_id);
CREATE INDEX IF NOT EXISTS idx_canonical_obl_sources_reg_source ON public.canonical_obligation_sources (regulatory_source_id);
CREATE INDEX IF NOT EXISTS idx_canonical_obl_sources_resolution ON public.canonical_obligation_sources (resolution_role);

-- Compositional applicability — does NOT physically fan out one row per
-- worker. Each entity dimension carries an explicit scope mode
-- ('specific'|'all'|'not_applicable') alongside its id, so NULL never
-- silently means "all" — e.g. client_scope='specific' + client_id=X +
-- worker_scope='all' + worker_id=NULL means "this obligation applies to
-- every worker where workers.client_id = X," resolved by the evaluation
-- engine via that join, not by a combinatorial enum value.
CREATE TABLE IF NOT EXISTS public.canonical_obligation_applicability (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_obligation_id  UUID NOT NULL REFERENCES public.canonical_obligations(id) ON DELETE CASCADE,
  client_scope              TEXT NOT NULL DEFAULT 'not_applicable',  -- 'specific' | 'all' | 'not_applicable'
  client_id                  TEXT REFERENCES public.clients(client_id) ON DELETE SET NULL,
  service_provider_scope       TEXT NOT NULL DEFAULT 'not_applicable',
  service_provider_id           TEXT REFERENCES public.service_providers(service_provider_id) ON DELETE SET NULL,
  worker_scope                    TEXT NOT NULL DEFAULT 'not_applicable',
  worker_id                        TEXT REFERENCES public.workers(worker_id) ON DELETE SET NULL,
  organization_scope                 TEXT NOT NULL DEFAULT 'not_applicable',  -- 'company' | 'not_applicable'
  jurisdiction                         TEXT,
  activity_scope                        TEXT,
  service_scope                          TEXT,
  relationship_role_scope                  TEXT,
  effective_from                             DATE,
  effective_until                             DATE,
  applicability_status                          TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'superseded'
  created_at                                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                                        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canonical_obl_applicability_obligation ON public.canonical_obligation_applicability (canonical_obligation_id);
CREATE INDEX IF NOT EXISTS idx_canonical_obl_applicability_client     ON public.canonical_obligation_applicability (client_id);
CREATE INDEX IF NOT EXISTS idx_canonical_obl_applicability_provider   ON public.canonical_obligation_applicability (service_provider_id);
CREATE INDEX IF NOT EXISTS idx_canonical_obl_applicability_worker     ON public.canonical_obligation_applicability (worker_id);

ALTER TABLE public.canonical_obligations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_obligation_sources         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_obligation_applicability    ENABLE ROW LEVEL SECURITY;
-- No policies granted — default-deny, service_role only.
