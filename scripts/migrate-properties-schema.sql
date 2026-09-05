-- Run this in the Supabase SQL Editor before seeding Sonesta data
-- Adds the three-owner model and hotel metadata columns to the assets table

ALTER TABLE assets ADD COLUMN IF NOT EXISTS property_owner_entity_id text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS business_owner_entity_id text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS management_company_entity_id text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS legacy_name text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS room_count integer;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS year_built integer;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS county text;
