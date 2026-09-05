-- ============================================================
-- Consola 360 — Schema Migration
-- Run this in: https://supabase.com/dashboard/project/afpqthxpatdmoctphhfm/sql/new
-- ============================================================

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

CREATE TABLE IF NOT EXISTS public.assets (
  asset_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  asset_type TEXT,
  entity_id TEXT,
  ownership_type TEXT,
  risk_score NUMERIC,
  street TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  acquisition_date DATE,
  use_description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.graph_edges (
  edge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  label TEXT,
  is_structural BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.documents (
  document_id TEXT PRIMARY KEY,
  title TEXT,
  document_type TEXT,
  document_subtype TEXT,
  entity_id TEXT,
  asset_id TEXT,
  counterparty_name TEXT,
  effective_date DATE,
  expiration_date DATE,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.obligations (
  obligation_id TEXT PRIMARY KEY,
  document_id TEXT,
  entity_id TEXT,
  asset_id TEXT,
  obligation_type TEXT,
  normalized_summary TEXT,
  trigger_type TEXT,
  trigger_scope TEXT,
  due_date DATE,
  status TEXT DEFAULT 'open',
  severity TEXT,
  confidence TEXT,
  document_section_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.events (
  event_id TEXT PRIMARY KEY,
  entity_id TEXT,
  asset_id TEXT,
  event_type TEXT NOT NULL,
  event_date DATE,
  status TEXT DEFAULT 'open',
  severity TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.obligation_matches (
  match_id TEXT PRIMARY KEY,
  event_id TEXT,
  obligation_id TEXT,
  match_method TEXT DEFAULT 'auto',
  match_confidence NUMERIC,
  status TEXT DEFAULT 'open',
  ai_reasoning TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, obligation_id)
);

-- Enable RLS
ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obligation_matches ENABLE ROW LEVEL SECURITY;

-- Allow anon and service_role full access (adjust per your security requirements)
CREATE POLICY "allow_all_entities" ON public.entities FOR ALL TO anon, service_role USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_assets" ON public.assets FOR ALL TO anon, service_role USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_graph_edges" ON public.graph_edges FOR ALL TO anon, service_role USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_documents" ON public.documents FOR ALL TO anon, service_role USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_obligations" ON public.obligations FOR ALL TO anon, service_role USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_events" ON public.events FOR ALL TO anon, service_role USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_obligation_matches" ON public.obligation_matches FOR ALL TO anon, service_role USING (true) WITH CHECK (true);

-- Propagation path recursive function
CREATE OR REPLACE FUNCTION public.get_propagation_path(
  start_entity_id TEXT,
  max_depth INTEGER DEFAULT 3
)
RETURNS TABLE(node_id TEXT, node_type TEXT, hop_depth INTEGER)
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE propagation AS (
    SELECT
      e.entity_id AS node_id,
      'entity'::TEXT AS node_type,
      0 AS hop_depth
    FROM entities e
    WHERE e.entity_id = start_entity_id

    UNION ALL

    SELECT
      ge.target_id AS node_id,
      ge.target_type AS node_type,
      p.hop_depth + 1 AS hop_depth
    FROM propagation p
    JOIN graph_edges ge ON ge.source_id = p.node_id
    WHERE p.hop_depth < max_depth
  )
  SELECT node_id, node_type, MIN(hop_depth) AS hop_depth
  FROM propagation
  GROUP BY node_id, node_type;
$$;

-- Enable realtime on events table
ALTER TABLE public.events REPLICA IDENTITY FULL;
