-- Run this in the Supabase SQL Editor.
-- Adds a city field to workers — new column to back the City field being
-- added to the Worker type and its Add/Edit forms.
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS city TEXT;
