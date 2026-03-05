-- Migration 010: Complete Odoo Integration
-- Adds missing l10n_mx fields, bank details, payment state tracking,
-- bank statement support, and purchase order tracking.

-- ── Invoices: Add missing l10n_mx and fiscal fields ──

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_tax DECIMAL(15,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_state TEXT; -- not_paid, in_payment, paid, partial, reversed
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS odoo_cfdi_uuid TEXT; -- UUID from Odoo l10n_mx_edi_cfdi_uuid (separate from SAT-validated cfdi_uuid)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS odoo_payment_method TEXT; -- Forma de pago from Odoo (03=SPEI, etc.)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS odoo_usage TEXT; -- Uso CFDI from Odoo (G01, G03, etc.)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'MXN';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS move_type TEXT; -- out_invoice, in_invoice, out_refund, in_refund
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_line_count INTEGER DEFAULT 0;

-- ── Vendors: Add bank name, regimen fiscal, payment terms ──

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS regimen_fiscal TEXT; -- 601, 612, 626, etc.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS supplier_rank INTEGER DEFAULT 0;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS payment_term TEXT; -- e.g., "30 dias", "60 dias"

-- ── Customers: Add regimen fiscal, customer rank ──

ALTER TABLE customers ADD COLUMN IF NOT EXISTS regimen_fiscal TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_rank INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_term TEXT;

-- ── Expenses: Add product category and payment mode ──

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS product_category TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_mode TEXT; -- own_account, company_account
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS sheet_id INTEGER; -- hr.expense.sheet ID in Odoo
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_reference TEXT; -- ticket/factura reference

-- ── Payments: Add reconciliation tracking ──

ALTER TABLE payments ADD COLUMN IF NOT EXISTS reconciled_invoice_ids JSONB DEFAULT '[]'; -- Odoo invoice IDs reconciled
ALTER TABLE payments ADD COLUMN IF NOT EXISTS odoo_state TEXT; -- draft, posted, sent, reconciled, cancelled

-- ── New Table: odoo_bank_statements ──
-- Tracks bank statement lines pushed to Odoo from Fintoc movements

CREATE TABLE IF NOT EXISTS odoo_bank_statements (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  odoo_statement_line_id INTEGER, -- ID in Odoo account.bank.statement.line
  bank_movement_id INTEGER REFERENCES bank_movements(id),
  payment_id INTEGER REFERENCES payments(id),
  journal_id INTEGER, -- Odoo account.journal ID
  partner_id INTEGER, -- Odoo res.partner ID
  date DATE NOT NULL,
  payment_ref TEXT,
  amount DECIMAL(15,2) NOT NULL,
  currency TEXT DEFAULT 'MXN',
  status TEXT DEFAULT 'pending', -- pending, pushed, matched, error
  odoo_match_status TEXT, -- auto_matched, manual_matched, unmatched
  error_message TEXT,
  pushed_at TIMESTAMPTZ,
  matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE odoo_bank_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY odoo_bank_statements_tenant ON odoo_bank_statements
  USING (company_id IN (SELECT id FROM companies));

CREATE INDEX IF NOT EXISTS idx_odoo_bs_company ON odoo_bank_statements(company_id);
CREATE INDEX IF NOT EXISTS idx_odoo_bs_movement ON odoo_bank_statements(bank_movement_id);
CREATE INDEX IF NOT EXISTS idx_odoo_bs_status ON odoo_bank_statements(company_id, status);

-- ── New Table: odoo_purchase_orders ──
-- Tracks purchase orders synced from Odoo

CREATE TABLE IF NOT EXISTS odoo_purchase_orders (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  odoo_id INTEGER NOT NULL,
  name TEXT NOT NULL, -- PO number (e.g., PO/2026/001)
  partner_id INTEGER, -- Odoo vendor ID
  partner_name TEXT,
  partner_rfc TEXT,
  vendor_id INTEGER REFERENCES vendors(id), -- Local vendor link
  state TEXT, -- draft, sent, purchase, done, cancel
  amount_total DECIMAL(15,2) DEFAULT 0,
  amount_tax DECIMAL(15,2) DEFAULT 0,
  currency TEXT DEFAULT 'MXN',
  date_order TIMESTAMPTZ,
  date_planned TIMESTAMPTZ,
  invoice_status TEXT, -- no, to_invoice, invoiced
  invoice_count INTEGER DEFAULT 0,
  receipt_status TEXT, -- pending, partial, full
  notes TEXT,
  source TEXT DEFAULT 'odoo',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE odoo_purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY odoo_purchase_orders_tenant ON odoo_purchase_orders
  USING (company_id IN (SELECT id FROM companies));

CREATE INDEX IF NOT EXISTS idx_odoo_po_company ON odoo_purchase_orders(company_id, odoo_id);
CREATE INDEX IF NOT EXISTS idx_odoo_po_vendor ON odoo_purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_odoo_po_state ON odoo_purchase_orders(company_id, state);

-- ── New Table: odoo_id_cache ──
-- Caches frequently-used Odoo IDs (journal, currency, payment method)
-- to avoid repeated lookups on every write-back operation

CREATE TABLE IF NOT EXISTS odoo_id_cache (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  cache_key TEXT NOT NULL, -- e.g., 'bank_journal_id', 'mxn_currency_id', 'transfer_method_line_id'
  odoo_id INTEGER NOT NULL,
  display_name TEXT,
  extra_data JSONB,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, cache_key)
);

ALTER TABLE odoo_id_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY odoo_id_cache_tenant ON odoo_id_cache
  USING (company_id IN (SELECT id FROM companies));

CREATE INDEX IF NOT EXISTS idx_odoo_cache_lookup ON odoo_id_cache(company_id, cache_key);
