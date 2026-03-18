-- Improve reconciliations table for the new reconciliation engine
-- Adds period tracking, better counts, and result summary storage

ALTER TABLE reconciliations
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end DATE,
  ADD COLUMN IF NOT EXISTS matched_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unmatched_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discrepancy_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS result_summary JSONB;

-- Index for fast history lookups
CREATE INDEX IF NOT EXISTS idx_reconciliations_company_type
  ON reconciliations (company_id, type, created_at DESC);
