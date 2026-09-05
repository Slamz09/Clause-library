-- Company Settings: lets the user register their own business entities
-- (name, aliases, EIN, address, contract contact) during onboarding. This is
-- what automatic counterparty/relationship detection (bulk upload and
-- Document Parser) matches contract party names against — see
-- lib/documents/classifyDocument.ts and app/api/entities/route.ts.
--
-- entities was only ever defined in the original scripts/schema.sql, which
-- was never applied to (or was later dropped from) this project's database
-- — create it here too so this script is self-contained regardless of
-- whether that table already exists.
CREATE TABLE IF NOT EXISTS public.entities (
  entity_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT,
  parent_entity_id TEXT,
  formation_date DATE,
  entity_subtype TEXT,
  risk_score NUMERIC,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS aliases JSONB DEFAULT '[]'::jsonb; -- other names/DBAs this entity is referred to by in contracts
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS ein TEXT;
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS contract_contact_name TEXT;
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS contract_contact_email TEXT;
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS notes TEXT;
