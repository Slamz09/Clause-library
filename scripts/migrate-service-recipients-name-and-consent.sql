-- ============================================================
-- Migrate service_recipients: name -> first_name/last_name,
-- consent_status -> recording_consent (per-technology).
-- Also adds service_engagements.recording_technologies.
-- Run once in Supabase SQL Editor, AFTER
-- scripts/migrate-riders-to-service-recipients.sql has been applied.
-- Safe to re-run (idempotent).
--
--   - `name` (single field) is replaced with `first_name` + `last_name`.
--     Existing values are split on the first space (best-effort); a
--     single-word name becomes first_name only, last_name ''.
--   - `consent_status` ('opt-in' | 'opt-out', one flag for all recording)
--     is replaced with `recording_consent` (JSONB: { in_app_video,
--     in_app_audio, dash_cam_video }, each 'opt-in' | 'opt-out') — a
--     recipient can now opt out of one recording technology (e.g. in-app
--     video) while staying opted in to another (e.g. dash cam), instead of
--     one all-or-nothing flag. Existing rows are backfilled so their old
--     single consent_status applies to all three technologies (a safe,
--     conservative default — nothing was previously more granular than
--     that, so no information is lost).
--   - service_engagements gets a new `recording_technologies` TEXT[]
--     column — which specific technologies (subset of 'in_app_video' |
--     'in_app_audio' | 'dash_cam_video') actually recorded during that
--     engagement, so compliance checks can respect per-technology consent
--     instead of treating video_recorded as all-or-nothing. NULL/empty on
--     existing rows (unknown technology — compliance checks fall back to
--     flagging on ANY opted-out technology for those, same as previous
--     behavior).
-- ============================================================

-- ── service_recipients: name -> first_name/last_name ────────────────────
ALTER TABLE public.service_recipients ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE public.service_recipients ADD COLUMN IF NOT EXISTS last_name TEXT;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_recipients' AND column_name = 'name') THEN
    UPDATE public.service_recipients
      SET first_name = COALESCE(NULLIF(split_part(name, ' ', 1), ''), name),
          last_name  = NULLIF(substring(name FROM position(' ' IN name) + 1), '')
      WHERE first_name IS NULL;
    ALTER TABLE public.service_recipients DROP COLUMN name;
  END IF;
END $$;

UPDATE public.service_recipients SET first_name = '' WHERE first_name IS NULL;
UPDATE public.service_recipients SET last_name = '' WHERE last_name IS NULL;
ALTER TABLE public.service_recipients ALTER COLUMN first_name SET NOT NULL;
ALTER TABLE public.service_recipients ALTER COLUMN last_name SET NOT NULL;

-- ── service_recipients: consent_status -> recording_consent ─────────────
ALTER TABLE public.service_recipients ADD COLUMN IF NOT EXISTS recording_consent JSONB;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_recipients' AND column_name = 'consent_status') THEN
    UPDATE public.service_recipients
      SET recording_consent = jsonb_build_object(
        'in_app_video', consent_status,
        'in_app_audio', consent_status,
        'dash_cam_video', consent_status
      )
      WHERE recording_consent IS NULL;
    ALTER TABLE public.service_recipients DROP COLUMN consent_status;
  END IF;
END $$;

UPDATE public.service_recipients
  SET recording_consent = '{"in_app_video":"opt-in","in_app_audio":"opt-in","dash_cam_video":"opt-in"}'::jsonb
  WHERE recording_consent IS NULL;
ALTER TABLE public.service_recipients ALTER COLUMN recording_consent SET NOT NULL;

-- ── service_engagements: + recording_technologies ────────────────────────
ALTER TABLE public.service_engagements ADD COLUMN IF NOT EXISTS recording_technologies TEXT[] NOT NULL DEFAULT '{}';
