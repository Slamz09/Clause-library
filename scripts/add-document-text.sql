ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS file_text TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS entity_name TEXT;
