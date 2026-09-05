-- ============================================================
-- Atomic obligation decomposition (chat 2026-08-24). A single clause often
-- bundles multiple independently satisfiable/violable requirements (SB-88
-- §39877 alone has ~14: license, age, background check, driving record,
-- drug testing, medical exam, TB assessment, training, ...). Extracting one
-- obligation per clause loses everything past the first item — this adds
-- the columns needed to decompose a clause into its real atomic terms while
-- preserving the relationship between a broader duty and a required
-- component that only makes sense as PART of it (e.g. "pass a criminal
-- background check, including fingerprint clearance" — fingerprint
-- clearance is HOW the check must be done, not a separately satisfiable
-- duty), as distinct from genuinely independent sibling requirements
-- (a criminal history check, a sex-offender registry check, and a DCFS
-- check are each separately satisfiable/violable even when one clause
-- states all three).
--
-- parent_obligation_id / obligation_kind: hierarchy. A 'required_component'
-- row's parent_obligation_id points at the broader duty it belongs to; a
-- 'primary' row (the default — every pre-existing row is 'primary') has no
-- parent. Self-referential FK on the same table this session already uses
-- for canonical-obligations self-references (see `superseded_by`) — this is
-- a different axis (hierarchy, not versioning).
--
-- source_excerpt / source_subsection: span-level provenance beyond
-- clause_id — the specific verbatim text and subsection marker (e.g.
-- "(a)(3)") this ONE atomic term traces back to within its clause, since
-- several atomic obligations now legitimately share one clause_id.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

ALTER TABLE public.canonical_obligations
  ADD COLUMN IF NOT EXISTS parent_obligation_id UUID REFERENCES public.canonical_obligations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS obligation_kind TEXT NOT NULL DEFAULT 'primary';
    -- 'primary' | 'required_component'

ALTER TABLE public.canonical_obligation_sources
  ADD COLUMN IF NOT EXISTS source_excerpt TEXT,
  ADD COLUMN IF NOT EXISTS source_subsection TEXT;

CREATE INDEX IF NOT EXISTS idx_canonical_obligations_parent ON public.canonical_obligations (parent_obligation_id);
CREATE INDEX IF NOT EXISTS idx_canonical_obligations_kind   ON public.canonical_obligations (obligation_kind);
