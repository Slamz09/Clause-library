-- ============================================================
-- canonical_obligations: requirement_effect + derivation.
--
-- These are the "requirement effect" and "explicit vs derived" axes from the
-- Clause Library spec. Neither is represented anywhere today:
--   - canonical_obligations.obligation_kind is 'primary' | 'required_component'
--     (a decomposition-hierarchy axis), NOT the operational effect.
--   - nothing distinguishes an obligation stated directly ("Provider shall
--     not record") from one derived from a Statement / Rep-Warranty /
--     Acknowledgment ("Client opts out of recordings" -> derived prohibition).
--
--   requirement_effect — the operational effect the language produces.
--                        Allowed: 'duty' | 'prohibition' | 'permission' |
--                        'right' | 'none'. NULL = not yet classified.
--   derivation         — 'explicit' (the clause states the obligation
--                        directly) | 'derived' (the obligation is the
--                        operational consequence of Statement / Rep-Warranty
--                        / Acknowledgment language). NULL = not yet classified.
--
-- The source clause keeps its own Category (e.g. 'statement') unchanged — a
-- derived obligation never rewrites the clause's Category to 'obligation'.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

ALTER TABLE public.canonical_obligations
  ADD COLUMN IF NOT EXISTS requirement_effect TEXT,
  ADD COLUMN IF NOT EXISTS derivation         TEXT;

-- Every existing canonical_obligations row was ingested directly from
-- obligation-bearing clause text (extractAtomicObligations skips definitions /
-- recitals), so they are all 'explicit'. requirement_effect is left NULL for
-- the existing backlog — it is classified going forward, and the UI renders
-- NULL as "unclassified" rather than guessing.
UPDATE public.canonical_obligations SET derivation = 'explicit' WHERE derivation IS NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_obligations_effect     ON public.canonical_obligations (requirement_effect);
CREATE INDEX IF NOT EXISTS idx_canonical_obligations_derivation ON public.canonical_obligations (derivation);
