-- Automatic document-type classification (bulk upload no longer requires a
-- manually-picked Document Type). documents.document_type stays the single
-- "effective" value everything else in the app already reads — these columns
-- add the audit trail around how it got set and what it originally was, so a
-- human correction never destroys the system's original classification.

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS document_type_confidence NUMERIC;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS document_type_classification_method TEXT; -- template_match | structural | semantic | unknown | manual

-- Frozen at whatever the classifier first produced — never overwritten by a
-- later human override (document_type / document_type_override below are).
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS system_document_type TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS system_document_type_confidence NUMERIC;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS system_document_type_method TEXT;

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS document_type_override TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS document_type_override_by TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS document_type_override_at TIMESTAMPTZ;

-- Paper Source and Template are distinct classifications from Document Type
-- (see lib/documents/classifyDocument.ts) — best-effort signals surfaced in
-- the bulk upload results table, not yet wired to contracts.paper_source
-- (that column is only populated once an actual contracts row links to this
-- document, same as the existing single-upload flow).
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS paper_source_guess TEXT; -- internal | counter_party
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS paper_source_confidence NUMERIC;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS matched_template_id TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS matched_template_name TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS matched_template_confidence NUMERIC;
