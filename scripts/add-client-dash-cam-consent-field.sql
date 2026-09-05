-- ============================================================
-- Add clients.dash_cam_video_consent_policy — splits the client-level
-- "video consent" policy into two independent axes: in-app/rider-facing
-- video (the existing video_consent_policy column) and dash cam video,
-- mirroring the per-technology granularity service_recipients.recording_consent
-- already has (in_app_video / in_app_audio / dash_cam_video). A contract can
-- set a different consent policy for the rider-facing camera than for a
-- vehicle-mounted dash cam, so these need to vary independently.
--
-- Nullable with NO default — a blank value means "unknown", never opt-out.
-- Set via 1) manual entry (Edit form), 2) CSV import (only if the sheet
-- includes this column), or 3) the clause extraction pipeline detecting it
-- in an uploaded contract (app/api/documents/classify-clauses).
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS dash_cam_video_consent_policy TEXT;
