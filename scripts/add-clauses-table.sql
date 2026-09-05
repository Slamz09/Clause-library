CREATE TABLE IF NOT EXISTS public.clauses (
  clause_id TEXT PRIMARY KEY,
  document_id TEXT,
  contract_family_id TEXT,
  clause_no TEXT,
  clause_type TEXT,
  clause_text TEXT,
  subtags TEXT[],
  obligation_type TEXT,
  ai_classification TEXT,
  ai_confidence NUMERIC,
  affiliates_bound TEXT[],
  review_status TEXT DEFAULT 'pending',
  complexity_score NUMERIC,
  balance_score NUMERIC,
  source_page INTEGER,
  char_start INTEGER,
  char_end INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.clauses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_clauses" ON public.clauses FOR ALL TO anon, service_role USING (true) WITH CHECK (true);
