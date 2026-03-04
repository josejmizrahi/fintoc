-- ══════════════════════════════════════════════════════════
-- Migration 005: bank_movements table, missing columns, constraint fixes
-- Run this in the Supabase SQL Editor AFTER migration 004
-- ══════════════════════════════════════════════════════════

-- ── Bank Movements (Fintoc webhook: account.movement_created) ──

CREATE TABLE IF NOT EXISTS bank_movements (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fintoc_id TEXT,
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'MXN',
  description TEXT,
  post_date TIMESTAMPTZ,
  type TEXT CHECK (type IN ('credit','debit')),
  reference_id TEXT,
  sender_account TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bank_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_movements_tenant ON bank_movements;
CREATE POLICY bank_movements_tenant ON bank_movements
  FOR ALL USING (company_id = auth_company_id());

DROP POLICY IF EXISTS bank_movements_insert ON bank_movements;
CREATE POLICY bank_movements_insert ON bank_movements
  FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_bank_movements_company ON bank_movements(company_id);
CREATE INDEX IF NOT EXISTS idx_bank_movements_fintoc_id ON bank_movements(fintoc_id);

-- ── Missing columns on payments ──

ALTER TABLE payments ADD COLUMN IF NOT EXISTS fintoc_payment_intent_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fintoc_transfer_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS sat_status TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_state TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_fintoc_pi ON payments(fintoc_payment_intent_id) WHERE fintoc_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_fintoc_tid ON payments(fintoc_transfer_id) WHERE fintoc_transfer_id IS NOT NULL;

-- ── Missing columns on invoices ──

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sat_status TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_state TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS partner_rfc TEXT;

-- ── Fix integrations provider constraint to allow 'general' ──

ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_provider_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_provider_check
  CHECK (provider IN ('odoo', 'fintoc', 'sat', 'general'));
