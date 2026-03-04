-- ══════════════════════════════════════════════════════════
-- Migration 004: Reconciliation entries for detailed tracking
-- Run this in the Supabase SQL Editor AFTER migration 003
-- ══════════════════════════════════════════════════════════

-- Add missing columns to reconciliations table for richer data
ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS period_days INTEGER DEFAULT 7;
ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS partial INTEGER DEFAULT 0;
ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS total_discrepancy NUMERIC(15,2) DEFAULT 0;

-- Detailed reconciliation entries
CREATE TABLE IF NOT EXISTS reconciliation_entries (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  reconciliation_id INTEGER REFERENCES reconciliations(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('fintoc-odoo', 'sat')),
  payment_ref TEXT,
  amount_erp NUMERIC(15,2) DEFAULT 0,
  amount_bank NUMERIC(15,2) DEFAULT 0,
  difference NUMERIC(15,2) DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('matched', 'unmatched', 'partial', 'manual')),
  cfdi_uuid TEXT,
  sat_status TEXT,
  notes TEXT,
  matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE reconciliation_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reconciliation_entries_tenant ON reconciliation_entries;
CREATE POLICY reconciliation_entries_tenant ON reconciliation_entries
  FOR ALL USING (company_id = auth_company_id());

DROP POLICY IF EXISTS reconciliation_entries_insert ON reconciliation_entries;
CREATE POLICY reconciliation_entries_insert ON reconciliation_entries
  FOR INSERT WITH CHECK (true);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_recon_entries_company ON reconciliation_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_recon_entries_recon_id ON reconciliation_entries(reconciliation_id);
