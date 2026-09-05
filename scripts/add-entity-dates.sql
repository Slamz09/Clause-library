-- Add formation date to entities table
ALTER TABLE entities ADD COLUMN IF NOT EXISTS date_of_formation DATE;

-- Add acquisition date to assets table
ALTER TABLE assets ADD COLUMN IF NOT EXISTS date_of_acquisition DATE;

-- Add parent document linking to documents table (for amendments/addenda)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS parent_doc_id TEXT REFERENCES documents(document_id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_relation TEXT; -- 'amendment', 'addendum', 'exhibit', 'renewal'

-- Add timeline events to documents (JSONB array of {id, date, event_type, description})
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_timeline JSONB DEFAULT '[]'::jsonb;
