-- Add employee count field to assets table (ski resort specific)
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS no_employees INTEGER;
