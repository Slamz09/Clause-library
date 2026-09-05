-- ============================================================
-- decision_traces — structured, per-item compliance verdict record.
--
-- compliance_evaluation_log (scripts/add-compliance-evaluation-log.sql)
-- already captures an immutable audit trail of each POST
-- /api/compliance/evaluate call, but as one flat `results` JSONB blob per
-- batch request — answering "what did the API return" but not "why", once
-- the underlying BGC_REQ_DATA/company-policy/contract rows that produced it
-- have since changed. decision_traces stores one row PER EVALUATED ITEM
-- (worker x client x state x requirement_category), with each standard's
-- verdict, its citation (legalId/contractId/policyId), which standard
-- controlled, and the relationship between the legal and contract cadence —
-- the ontology's Decision/DecisionTrace concept (see docs/ontology.md).
--
-- Same RLS posture as compliance_evaluation_log: default-deny, service-role
-- only, written from app/api/compliance/evaluate/route.ts (requireSession-gated).
-- Not a replacement for compliance_evaluation_log — that table stays the raw
-- batch audit log; this one is the structured per-item trace.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.decision_traces (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_id            TEXT,                    -- correlates back to compliance_evaluation_log.request_id
  worker_id             TEXT NOT NULL,
  client_id             TEXT NOT NULL,
  state                 TEXT NOT NULL,
  service_engagement_id TEXT,
  requirement_category  TEXT NOT NULL,            -- 'background_check' | 'recording_consent'
  standards             JSONB NOT NULL DEFAULT '[]'::jsonb, -- DecisionTraceStandardResult[] (lib/ontology/types.ts)
  controlling_standard  TEXT,                     -- 'legal' | 'contract' | 'policy'
  relationship          TEXT,                     -- 'satisfies' | 'supplements' | 'moreRestrictiveThan' | 'conflicts'
  result                TEXT NOT NULL             -- 'compliant' | 'non-compliant'
);

CREATE INDEX IF NOT EXISTS decision_traces_created_at_idx ON public.decision_traces (created_at);
CREATE INDEX IF NOT EXISTS decision_traces_worker_id_idx ON public.decision_traces (worker_id);
CREATE INDEX IF NOT EXISTS decision_traces_request_id_idx ON public.decision_traces (request_id);

ALTER TABLE public.decision_traces ENABLE ROW LEVEL SECURITY;
-- No policies granted — default-deny for anon/authenticated roles.
-- service_role bypasses RLS and is the only writer/reader (route handler
-- uses createServerClient, a service_role client), matching
-- compliance_evaluation_log's posture.
