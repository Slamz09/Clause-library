-- ============================================================
-- saved_obligations — the SavedObligation shape (docs/ontology.md §3).
--
-- One row per manually-reviewed clause a user chose to save as an
-- obligation, via app/(app)/documents/page.tsx's autoSaveObligations and
-- managed through the Obligations list/filter UI (ObligationsTab in the
-- same file) and app/api/obligations/route.ts. Column set matches exactly
-- what that route's GET/POST/PATCH/DELETE handlers and autoSaveObligations
-- actually construct and query — verified against the live code, not
-- inferred.
--
-- Deliberately a SEPARATE table from `obligations` (the ObligationExtraction
-- shape — see create-obligations-table.sql), not a merge of the two. They
-- differ in granularity (per-clause here vs. per-atomic-clause-unit there)
-- and in provenance model (entity_id/asset_id here, a legacy link into the
-- entities/assets registry, vs. actor/beneficiary there, roles parsed from
-- clause text). See docs/ontology.md §3's "Obligation persistence and
-- provenance" section and its canonical-to-legacy field mapping table for
-- the full reasoning — in short: obligation_type here and
-- canonical_clause_type on `obligations` are the one column pair that
-- genuinely share a vocabulary (CANONICAL_CLAUSE_TYPES); everything else is
-- a different axis on purpose, not a naming inconsistency to fix.
--
-- entity_id/asset_id/related_entity_id/related_asset_id are kept as plain
-- TEXT with no FK constraint — this is the legacy risk-graph linkage
-- (entities/assets tables), explicitly NOT promoted into the ontology's
-- canonical ContractualObligation definition per docs/ontology.md §3. Kept
-- here only because app/api/obligations/route.ts's existing
-- recomputeObligationRisk/event_obligation_impacts integration (unmodified
-- by this migration — a separate, already-documented open question in
-- docs/implementation-plan.md) still reads them.
--
-- This table never existed in the live database — confirmed 2026-08-23 the
-- same way as `obligations` (PGRST205 via both a direct query and the
-- running app's own GET /api/obligations).
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.saved_obligations (
  obligation_id        TEXT PRIMARY KEY,
  -- Whether the real-world obligation was fulfilled — not whether this row
  -- is current (that's `obligations.status`, a different axis; see
  -- docs/ontology.md §3).
  status               TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'satisfied' | 'breached' | 'waived' | 'unknown'
  source_document_id   TEXT NULL,
  document_id          TEXT NULL,
  source_clause_id     TEXT NULL,
  -- Same vocabulary as obligations.canonical_clause_type — both are
  -- lib/clauseTypes.ts's CANONICAL_CLAUSE_TYPES. See docs/ontology.md §3.
  obligation_type      TEXT NULL,
  action_text          TEXT NULL,
  source_text          TEXT NULL,
  confidence           NUMERIC NULL,
  -- Legacy entity/asset linkage — not part of the canonical ontology, kept
  -- only for the existing risk-recompute integration. See header note above.
  entity_id            TEXT NULL,
  related_entity_id    TEXT NULL,
  asset_id             TEXT NULL,
  related_asset_id     TEXT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_obligations_document_id        ON public.saved_obligations (document_id);
CREATE INDEX IF NOT EXISTS idx_saved_obligations_source_document_id ON public.saved_obligations (source_document_id);
CREATE INDEX IF NOT EXISTS idx_saved_obligations_source_clause_id   ON public.saved_obligations (source_clause_id);
CREATE INDEX IF NOT EXISTS idx_saved_obligations_status             ON public.saved_obligations (status);
CREATE INDEX IF NOT EXISTS idx_saved_obligations_type               ON public.saved_obligations (obligation_type);
CREATE INDEX IF NOT EXISTS idx_saved_obligations_entity_id          ON public.saved_obligations (entity_id);
CREATE INDEX IF NOT EXISTS idx_saved_obligations_asset_id           ON public.saved_obligations (asset_id);

ALTER TABLE public.saved_obligations ENABLE ROW LEVEL SECURITY;
-- No policies granted — default-deny for anon/authenticated roles.
-- service_role bypasses RLS and is the only writer/reader
-- (app/api/obligations/route.ts uses createServerClient(), a service_role
-- client), matching compliance_evaluation_log's, decision_traces's, and
-- obligations's posture.
