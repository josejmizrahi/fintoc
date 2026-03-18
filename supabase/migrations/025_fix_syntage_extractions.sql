-- Fix syntage_extractions table: add missing error_code column and unique constraint
-- Required for webhook handler (writes error_code) and sync provider (upserts on syntage_extraction_id)

ALTER TABLE syntage_extractions
  ADD COLUMN IF NOT EXISTS error_code VARCHAR(50);

-- Unique constraint needed for upsert onConflict: 'syntage_extraction_id'
ALTER TABLE syntage_extractions
  ADD CONSTRAINT uq_syntage_extraction_id UNIQUE (syntage_extraction_id);

-- Index for fast webhook lookups
CREATE INDEX IF NOT EXISTS idx_syntage_extractions_extraction_id
  ON syntage_extractions (syntage_extraction_id);

-- Index for company-level queries on the sync page
CREATE INDEX IF NOT EXISTS idx_syntage_extractions_company_status
  ON syntage_extractions (company_id, status);
