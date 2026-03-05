-- Migration 008: Full Fintoc integration + Odoo write-back support
-- Adds columns for: outbound transfers, JWS signing, CLABE verification,
-- dedicated CLABEs, complemento de pago, Odoo write-back, bank_movement linkage

-- ──────────────────────────────────────────────
-- Step 1: Payments — Odoo write-back & complemento de pago
-- ──────────────────────────────────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS odoo_payment_id INTEGER;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS complemento_emitido BOOLEAN DEFAULT FALSE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS complemento_uuid TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS jws_signed BOOLEAN DEFAULT FALSE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS bank_movement_id INTEGER REFERENCES bank_movements(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS clabe_destination TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_odoo_pid ON payments(odoo_payment_id) WHERE odoo_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_bm ON payments(bank_movement_id) WHERE bank_movement_id IS NOT NULL;

-- ──────────────────────────────────────────────
-- Step 2: Customers — Fintoc Account Numbers (dedicated CLABEs)
-- ──────────────────────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS fintoc_account_number_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS fintoc_clabe TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_fintoc_an ON customers(fintoc_account_number_id) WHERE fintoc_account_number_id IS NOT NULL;

-- ──────────────────────────────────────────────
-- Step 3: Vendors — CLABE verification
-- ──────────────────────────────────────────────
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS clabe_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS clabe_holder_name TEXT;

-- ──────────────────────────────────────────────
-- Step 4: Invoices — payment policy (PUE/PPD) for complemento de pago
-- ──────────────────────────────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_policy TEXT CHECK (payment_policy IN ('PUE', 'PPD'));

-- ──────────────────────────────────────────────
-- Step 5: Bank movements — add payment linkage columns
-- ──────────────────────────────────────────────
ALTER TABLE bank_movements ADD COLUMN IF NOT EXISTS account_id TEXT;
ALTER TABLE bank_movements ADD COLUMN IF NOT EXISTS counterpart_name TEXT;
ALTER TABLE bank_movements ADD COLUMN IF NOT EXISTS counterpart_account TEXT;
ALTER TABLE bank_movements ADD COLUMN IF NOT EXISTS fintoc_account_number_id TEXT;

-- ──────────────────────────────────────────────
-- Step 6: Webhook events log for audit trail
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_events (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_id TEXT,
  payload JSONB,
  processed BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_company ON webhook_events(company_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON webhook_events(event_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_eid ON webhook_events(event_id) WHERE event_id IS NOT NULL;

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_events_insert ON webhook_events FOR INSERT WITH CHECK (true);
CREATE POLICY webhook_events_select ON webhook_events FOR SELECT USING (company_id = auth_company_id());
