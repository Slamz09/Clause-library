-- ============================================================
-- Split clients.default_consent_policy into three independent axes:
-- video recording, audio recording, and AI use — mirroring the per-recipient
-- granularity service_recipients.recording_consent already has
-- (in_app_video/in_app_audio/dash_cam_video), instead of one blanket flag.
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
--
--   - `default_consent_policy` is renamed to `video_consent_policy` — it was
--     already only ever driven by video-recording clauses (see
--     app/api/documents/classify-clauses's "Recording Consent Clause"
--     backfill), so this is a rename for clarity, not a behavior change.
--   - `audio_consent_policy` and `ai_use_consent_policy` are new columns,
--     nullable with NO default. Unlike the old field (which defaulted new
--     clients to 'opt-out'), a blank value here means "unknown" — it must
--     stay blank until a user fills it in via the Edit form, a CSV import
--     explicitly states it, or the clause extraction pipeline detects it in
--     an uploaded contract. Nothing should ever silently turn a blank into
--     an opt-out.
--   - `video_consent_policy` also loses its 'opt-out' default and NOT NULL
--     (if either was ever set) for the same reason — existing rows keep
--     their current value; only the default for *new* rows changes.
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'default_consent_policy')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'video_consent_policy') THEN
    ALTER TABLE public.clients RENAME COLUMN default_consent_policy TO video_consent_policy;
  END IF;
END $$;

ALTER TABLE public.clients ALTER COLUMN video_consent_policy DROP NOT NULL;
ALTER TABLE public.clients ALTER COLUMN video_consent_policy DROP DEFAULT;

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS audio_consent_policy TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS ai_use_consent_policy TEXT;

-- `city` was already a field on the app's Client type and rendered in the
-- clients table, but was never actually a column on this table (GET never
-- selected it, POST never accepted it) — every client has shown a blank
-- city no matter what was entered. Bundled here since it's the same class
-- of fix (a real column the app assumes exists).
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS city TEXT;
