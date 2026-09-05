-- ============================================================
-- obligations — the ObligationExtraction shape (docs/ontology.md §3).
--
-- One row per atomic obligation derived from a clause_unit by the
-- deep-extraction pipeline (app/api/documents/classify-clauses/route.ts →
-- lib/obligations/normalize.ts's normalizeClauseUnitToObligation), typed
-- exactly to lib/legalUnitTypes.ts's ObligationRecord — every column here
-- corresponds 1:1 to a field that function actually constructs, so the
-- existing, already-tested extraction code works against this table
-- unmodified.
--
-- This table never existed in the live database (confirmed 2026-08-23 via
-- direct query and via the running app's own API returning PGRST205 "table
-- not found"), despite two draft migrations existing in this repo — see the
-- superseded-file notes in add-obligations-table.sql and
-- add-obligations-schema.sql. This file replaces add-obligations-table.sql's
-- column/index definitions (which were already correct) with the
-- default-deny RLS posture this app has since standardized on (matching
-- compliance_evaluation_log and decision_traces) instead of that draft's
-- looser `USING (true)` policies, which would have allowed anon/authenticated
-- read-write access to extracted contract obligations directly via the
-- Supabase REST API, bypassing requireSession entirely.
--
-- Do NOT add the legacy entity_id/asset_id/obligation_type columns here —
-- those belong to the separate `saved_obligations` table (see
-- create-saved-obligations-table.sql). This table and that one are
-- deliberately not merged; see docs/ontology.md §3's canonical-to-legacy
-- field mapping for why.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.obligations (
  obligation_id         TEXT PRIMARY KEY,
  clause_unit_id        TEXT NULL REFERENCES clause_units(clause_unit_id) ON DELETE SET NULL,
  clause_id             TEXT NOT NULL REFERENCES clauses(clause_id) ON DELETE CASCADE,
  document_id           TEXT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
  obligation_kind       TEXT NOT NULL,        -- 'duty' | 'prohibition' | 'right' | 'condition' | 'definition' | 'representation' | 'warranty'
  actor                 TEXT NULL,
  beneficiary            TEXT NULL,
  action_text           TEXT NOT NULL,
  object_text           TEXT NULL,
  trigger_text          TEXT NULL,
  deadline_text         TEXT NULL,
  frequency_text        TEXT NULL,
  qualifier_text        TEXT NULL,
  exception_text        TEXT NULL,
  -- Cross-cutting concern tags, derived from canonical_clause_type via
  -- lib/clauseTypes.ts's mapCanonicalTypeToTopicLabels() — not an
  -- independently-set field.
  topic_labels          TEXT[] NOT NULL DEFAULT '{}',
  -- The topic/subject-matter axis — same vocabulary as saved_obligations'
  -- obligation_type (both = lib/clauseTypes.ts's CANONICAL_CLAUSE_TYPES).
  -- See docs/ontology.md §3.
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
  -- Whether THIS EXTRACTED RECORD is still current (e.g. superseded by a
  -- re-run of deep-extract) — not whether the real-world obligation was
  -- fulfilled. See docs/ontology.md §3 (do not conflate with
  -- saved_obligations.status, which is a different axis despite sharing
  -- the 'active'/'waived' spellings).
  status                TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'superseded' | 'waived'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obligations_clause_id      ON public.obligations (clause_id);
CREATE INDEX IF NOT EXISTS idx_obligations_document_id    ON public.obligations (document_id);
CREATE INDEX IF NOT EXISTS idx_obligations_clause_unit_id ON public.obligations (clause_unit_id);
CREATE INDEX IF NOT EXISTS idx_obligations_kind           ON public.obligations (obligation_kind);
CREATE INDEX IF NOT EXISTS idx_obligations_monitor        ON public.obligations (monitor_flag) WHERE monitor_flag = true;
CREATE INDEX IF NOT EXISTS idx_obligations_review         ON public.obligations (needs_review) WHERE needs_review = true;

ALTER TABLE public.obligations ENABLE ROW LEVEL SECURITY;
-- No policies granted — default-deny for anon/authenticated roles.
-- service_role bypasses RLS and is the only writer/reader (the
-- classify-clauses route uses createServerClient(), a service_role client),
-- matching compliance_evaluation_log's and decision_traces's posture.
