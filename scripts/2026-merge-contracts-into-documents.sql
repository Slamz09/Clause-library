-- ============================================================
-- Merge `contracts` into `documents`.
--
-- A contract is no longer a separate row with its own CNT-### id — it is the
-- Documents row itself. This migration adds the contract-relationship columns
-- to `documents` and backfills them from the (4) legacy `contracts` rows.
--
-- The legacy `contracts` table is LEFT IN PLACE (not dropped) so nothing that
-- still reads it directly breaks mid-rollout; /api/contracts now reads and
-- writes `documents` and only falls back to the legacy table for reads.
--
-- Run once in the Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

-- bgc_requirement_types is JSONB in the live contracts table, so match it
-- here. (An earlier run may have added it as text[]; drop + re-add.)
ALTER TABLE public.documents DROP COLUMN IF EXISTS bgc_requirement_types;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS contract_facing               TEXT,      -- 'client' | 'vendor'
  ADD COLUMN IF NOT EXISTS linked_client_id              TEXT,
  ADD COLUMN IF NOT EXISTS linked_client_name            TEXT,
  ADD COLUMN IF NOT EXISTS linked_vendor_id              TEXT,
  ADD COLUMN IF NOT EXISTS linked_vendor_name            TEXT,
  ADD COLUMN IF NOT EXISTS governing_law                 TEXT,
  ADD COLUMN IF NOT EXISTS paper_source                  TEXT,      -- 'internal' | 'counter_party'
  ADD COLUMN IF NOT EXISTS counterparty_type             TEXT,
  ADD COLUMN IF NOT EXISTS contract_type                 TEXT,
  ADD COLUMN IF NOT EXISTS company_entity_id             TEXT,
  ADD COLUMN IF NOT EXISTS recording_rule                TEXT,
  ADD COLUMN IF NOT EXISTS recording_rule_clause_id      TEXT,
  ADD COLUMN IF NOT EXISTS bgc_interval_months           INTEGER,
  ADD COLUMN IF NOT EXISTS bgc_interval_clause_id        TEXT,
  ADD COLUMN IF NOT EXISTS bgc_requirement_types         JSONB,
  ADD COLUMN IF NOT EXISTS client_specific_bgc_requirements TEXT,
  ADD COLUMN IF NOT EXISTS privacy_requirements          TEXT,
  ADD COLUMN IF NOT EXISTS governing_law_clause_id       TEXT,
  ADD COLUMN IF NOT EXISTS effective_date_clause_id      TEXT,
  ADD COLUMN IF NOT EXISTS expiration_date_clause_id     TEXT,
  ADD COLUMN IF NOT EXISTS extracted_obligations         TEXT,
  -- The legacy CNT-### id, preserved on the document it belonged to so old
  -- deep links (?contract=CNT-004) can still resolve.
  ADD COLUMN IF NOT EXISTS legacy_contract_id            TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_linked_client_id   ON public.documents (linked_client_id);
CREATE INDEX IF NOT EXISTS idx_documents_linked_vendor_id   ON public.documents (linked_vendor_id);
CREATE INDEX IF NOT EXISTS idx_documents_legacy_contract_id ON public.documents (legacy_contract_id);

-- Backfill from the legacy contracts rows (no-op if the table is empty).
-- effective_date / expiration_date are intentionally NOT backfilled here —
-- documents already has those columns and the legacy values are free-text.
UPDATE public.documents d SET
  contract_facing               = COALESCE(d.contract_facing, c.contract_facing),
  linked_client_id              = COALESCE(NULLIF(d.linked_client_id, ''), NULLIF(c.linked_client_id, '')),
  linked_client_name            = COALESCE(NULLIF(d.linked_client_name, ''), NULLIF(c.linked_client_name, '')),
  linked_vendor_id              = COALESCE(NULLIF(d.linked_vendor_id, ''), NULLIF(c.linked_vendor_id, '')),
  linked_vendor_name            = COALESCE(NULLIF(d.linked_vendor_name, ''), NULLIF(c.linked_vendor_name, '')),
  governing_law                 = COALESCE(NULLIF(d.governing_law, ''), NULLIF(c.governing_law, '')),
  paper_source                  = COALESCE(NULLIF(d.paper_source, ''), NULLIF(c.paper_source, '')),
  counterparty_type             = COALESCE(NULLIF(d.counterparty_type, ''), NULLIF(c.counterparty_type, '')),
  contract_type                 = COALESCE(NULLIF(d.contract_type, ''), NULLIF(c.contract_type, '')),
  company_entity_id             = COALESCE(d.company_entity_id, c.company_entity_id),
  recording_rule                = COALESCE(d.recording_rule, c.recording_rule),
  recording_rule_clause_id      = COALESCE(d.recording_rule_clause_id, c.recording_rule_clause_id),
  bgc_interval_months           = COALESCE(d.bgc_interval_months, c.bgc_interval_months),
  bgc_interval_clause_id        = COALESCE(d.bgc_interval_clause_id, c.bgc_interval_clause_id),
  bgc_requirement_types         = COALESCE(d.bgc_requirement_types, c.bgc_requirement_types),
  client_specific_bgc_requirements = COALESCE(d.client_specific_bgc_requirements, c.client_specific_bgc_requirements),
  privacy_requirements          = COALESCE(d.privacy_requirements, c.privacy_requirements),
  governing_law_clause_id       = COALESCE(d.governing_law_clause_id, c.governing_law_clause_id),
  effective_date_clause_id      = COALESCE(d.effective_date_clause_id, c.effective_date_clause_id),
  expiration_date_clause_id     = COALESCE(d.expiration_date_clause_id, c.expiration_date_clause_id),
  extracted_obligations         = COALESCE(d.extracted_obligations, c.extracted_obligations),
  legacy_contract_id            = COALESCE(d.legacy_contract_id, c.contract_id)
FROM public.contracts c
WHERE c.document_id = d.document_id;
