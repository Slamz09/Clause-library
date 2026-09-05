-- ============================================================
-- Regulatory applicability rule engine (docs/ontology.md §7).
--
-- A regulatory source may apply even if no contract/order form/policy
-- expressly cites it. This engine evaluates the ACTUAL applicability
-- conditions extracted from the legal text against known entity/relationship/
-- activity facts, using three-valued logic (true/false/unknown — unknown
-- never silently becomes true or false).
--
-- Depends on: create-regulatory-sources.sql (regulatory_sources, clauses)
-- and create-fact-layer.sql (fact_definitions, entity_facts). Run this file
-- AFTER both of those.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

-- Expression tree: a node is either a group (logic_operator set, combines
-- its children) or a leaf (logic_operator null, has exactly one row in
-- regulatory_applicability_predicates). Supports arbitrary AND/OR nesting —
-- e.g. CCPA-style "(revenue > $25M) OR (records > 100k) OR (pct_revenue >= 50%)"
-- is one OR node with three leaf children.
CREATE TABLE IF NOT EXISTS public.regulatory_applicability_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  regulatory_source_id  UUID NOT NULL REFERENCES public.regulatory_sources(id) ON DELETE CASCADE,
  -- Optional: scopes this rule to ONE provision rather than the whole
  -- source, when applicability varies by provision within the same statute.
  clause_id             TEXT REFERENCES public.clauses(clause_id) ON DELETE SET NULL,
  parent_rule_id        UUID REFERENCES public.regulatory_applicability_rules(id) ON DELETE CASCADE,
  logic_operator        TEXT,   -- 'AND' | 'OR' | NULL (null = leaf node)
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reg_appl_rules_source ON public.regulatory_applicability_rules (regulatory_source_id);
CREATE INDEX IF NOT EXISTS idx_reg_appl_rules_parent ON public.regulatory_applicability_rules (parent_rule_id);

-- One row per LEAF rule node. The exact legal threshold/operator/unit lives
-- here, tied to the regulatory_source's version — never hardcoded in
-- application code. A statutory amendment that changes a threshold is a new
-- regulatory_sources version with its own rules/predicates.
CREATE TABLE IF NOT EXISTS public.regulatory_applicability_predicates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id               UUID NOT NULL REFERENCES public.regulatory_applicability_rules(id) ON DELETE CASCADE,
  fact_definition_id    UUID NOT NULL REFERENCES public.fact_definitions(id),
  operator              TEXT NOT NULL,  -- 'equals'|'not_equals'|'greater_than'|'greater_than_or_equal'|
                                          -- 'less_than'|'less_than_or_equal'|'in'|'contains'|'exists'
  comparison_value       JSONB NOT NULL,
  unit                    TEXT,
  negated                 BOOLEAN NOT NULL DEFAULT false,
  material_to_outcome      BOOLEAN NOT NULL DEFAULT true,
  extraction_confidence     NUMERIC,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reg_appl_predicates_rule ON public.regulatory_applicability_predicates (rule_id);
CREATE INDEX IF NOT EXISTS idx_reg_appl_predicates_fact ON public.regulatory_applicability_predicates (fact_definition_id);

-- Append-only. A re-evaluation creates a NEW row — never overwrites an old
-- conclusion, so a past compliance determination stays reproducible even if
-- the regulatory_source version or the underlying facts change later.
CREATE TABLE IF NOT EXISTS public.regulatory_applicability_determinations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  regulatory_source_id        UUID NOT NULL REFERENCES public.regulatory_sources(id),
  subject_entity_type         TEXT NOT NULL,   -- 'company' | 'client' | 'worker' | 'service_provider'
  subject_entity_id           TEXT NOT NULL,
  -- Reproducible snapshot of relationship/activity context used (e.g. from
  -- contracts/service_engagements) — derived history, not the authoritative
  -- source of the underlying fact. A later contract edit must not
  -- retroactively change what a past determination says it saw.
  activity_context             JSONB,
  applicability_outcome         TEXT NOT NULL,   -- 'applies' | 'does_not_apply' | 'indeterminate'
  -- Deliberately separate from applicability_outcome — a legal conclusion
  -- and a workflow state are different axes (see docs/ontology.md §7).
  review_status                  TEXT NOT NULL DEFAULT 'auto_resolved',
    -- 'auto_resolved' | 'review_required' | 'human_confirmed' | 'human_overridden'
  evaluated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_by_determination_id   UUID REFERENCES public.regulatory_applicability_determinations(id),
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reg_appl_determinations_source  ON public.regulatory_applicability_determinations (regulatory_source_id);
CREATE INDEX IF NOT EXISTS idx_reg_appl_determinations_subject ON public.regulatory_applicability_determinations (subject_entity_type, subject_entity_id);
CREATE INDEX IF NOT EXISTS idx_reg_appl_determinations_outcome ON public.regulatory_applicability_determinations (applicability_outcome, review_status);

-- Relational, not a JSONB blob — exact traceability from a determination to
-- every predicate it evaluated, to exactly which fact (or which existing
-- relationship/activity record) supplied the answer.
CREATE TABLE IF NOT EXISTS public.regulatory_predicate_evaluations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  determination_id   UUID NOT NULL REFERENCES public.regulatory_applicability_determinations(id) ON DELETE CASCADE,
  predicate_id       UUID NOT NULL REFERENCES public.regulatory_applicability_predicates(id),
  -- Exactly one of entity_fact_id or (source_record_type + source_record_id
  -- + source_field) should be set when result != 'unknown' — entity_fact_id
  -- when resolved from entity_facts, the source_record_* triple when
  -- resolved directly from an existing table (contracts, service_engagements,
  -- workers, clients, service_providers) per the fact-resolution-order
  -- principle in docs/ontology.md §7. Both null is expected when result = 'unknown'.
  entity_fact_id      UUID REFERENCES public.entity_facts(id),
  source_record_type  TEXT,   -- e.g. 'contract' | 'service_engagement' | 'worker' | 'client' | 'service_provider'
  source_record_id    TEXT,
  source_field         TEXT,   -- e.g. 'contract_facing', 'state'
  evaluated_value        JSONB,
  result                  TEXT NOT NULL,   -- 'true' | 'false' | 'unknown'
  reason                   TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reg_predicate_evals_determination ON public.regulatory_predicate_evaluations (determination_id);
CREATE INDEX IF NOT EXISTS idx_reg_predicate_evals_predicate     ON public.regulatory_predicate_evaluations (predicate_id);
CREATE INDEX IF NOT EXISTS idx_reg_predicate_evals_entity_fact   ON public.regulatory_predicate_evaluations (entity_fact_id);

ALTER TABLE public.regulatory_applicability_rules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regulatory_applicability_predicates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regulatory_applicability_determinations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regulatory_predicate_evaluations          ENABLE ROW LEVEL SECURITY;
-- No policies granted — default-deny, service_role only.
