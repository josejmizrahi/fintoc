-- Migration 007: Fix schema gaps
-- Resolves: #3 (no odoo_id), #12 (ghost columns), #14 (no updated_at), #4 (fintoc_institution_id), #10 (invoice_id on cfdi)

-- ──────────────────────────────────────────────
-- Step 1: Add odoo_id to all synced tables
-- ──────────────────────────────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS odoo_id INTEGER;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS odoo_id INTEGER;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS odoo_id INTEGER;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS odoo_id INTEGER;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS odoo_id INTEGER;

-- Unique composite indexes for upsert by (company_id, odoo_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_odoo ON invoices(company_id, odoo_id) WHERE odoo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_odoo ON payments(company_id, odoo_id) WHERE odoo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_odoo ON vendors(company_id, odoo_id) WHERE odoo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_odoo ON customers(company_id, odoo_id) WHERE odoo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_odoo ON expenses(company_id, odoo_id) WHERE odoo_id IS NOT NULL;

-- ──────────────────────────────────────────────
-- Step 2: Add source where missing
-- ──────────────────────────────────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- Backfill source for existing invoices
UPDATE invoices SET source = 'odoo' WHERE source IS NULL AND cfdi_uuid IS NOT NULL;
UPDATE invoices SET source = 'manual' WHERE source IS NULL;

-- ──────────────────────────────────────────────
-- Step 3: Add updated_at where missing
-- ──────────────────────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Auto-update trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all relevant tables
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['customers', 'vendors', 'invoices', 'payments', 'cfdi_documents', 'expenses'])
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I; CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at();',
      t, t, t, t
    );
  END LOOP;
END;
$$;

-- ──────────────────────────────────────────────
-- Step 4: Fix ghost columns in payments
-- ──────────────────────────────────────────────
ALTER TABLE payments ALTER COLUMN sat_status SET DEFAULT 'unknown';
ALTER TABLE payments ALTER COLUMN payment_state SET DEFAULT 'pending';

-- ──────────────────────────────────────────────
-- Step 5: Add invoice_id to cfdi_documents
-- ──────────────────────────────────────────────
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id);

-- ──────────────────────────────────────────────
-- Step 6: Add fintoc_institution_id to invoices
-- ──────────────────────────────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fintoc_institution_id TEXT;

-- ──────────────────────────────────────────────
-- Step 7: Unique index on bank_movements.fintoc_id
-- ──────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_bm_fintoc ON bank_movements(fintoc_id) WHERE fintoc_id IS NOT NULL;
