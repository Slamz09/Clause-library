-- Structured BGC screening-method requirement: which method(s) apply (Name
-- Search / Fingerprinting) and, per method, which jurisdiction level(s)
-- (State / Federal / both). Distinct from the existing free-text
-- workers.bgc_type description column. Stored as JSONB array of
-- { type, jurisdiction: string[], states?: string[] } — see
-- lib/bgcTypeOptions.ts. The `states` field is only ever populated on
-- workers (contract/client requirements are jurisdiction-level only).

ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS bgc_requirement_types JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.clients   ADD COLUMN IF NOT EXISTS bgc_requirement_types JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.workers   ADD COLUMN IF NOT EXISTS bgc_requirement_types JSONB DEFAULT '[]'::jsonb;
