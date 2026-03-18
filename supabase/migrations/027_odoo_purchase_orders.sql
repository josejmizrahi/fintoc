-- Migration 027: Recreate odoo_purchase_orders table for full Odoo sync
-- This table was previously dropped in migration 019 but is needed for complete sync.

CREATE TABLE IF NOT EXISTS odoo_purchase_orders (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  odoo_id INTEGER NOT NULL,
  name VARCHAR(100) NOT NULL,
  partner_id INTEGER,
  partner_name TEXT,
  partner_rfc VARCHAR(13),
  vendor_id INTEGER REFERENCES vendors(id),
  state VARCHAR(20) DEFAULT 'draft',
  amount_total NUMERIC(15,2) DEFAULT 0,
  amount_tax NUMERIC(15,2) DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'MXN',
  date_order DATE,
  date_planned DATE,
  invoice_status VARCHAR(20) DEFAULT 'no',
  invoice_count INTEGER DEFAULT 0,
  notes TEXT,
  source TEXT DEFAULT 'odoo',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT odoo_po_company_odoo_id_unique UNIQUE (company_id, odoo_id)
);

-- RLS
ALTER TABLE odoo_purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "odoo_purchase_orders_tenant_isolation"
  ON odoo_purchase_orders
  FOR ALL
  USING (company_id::text = (auth.jwt() ->> 'active_company_id'))
  WITH CHECK (company_id::text = (auth.jwt() ->> 'active_company_id'));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_odoo_po_company ON odoo_purchase_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_odoo_po_state ON odoo_purchase_orders(company_id, state);
CREATE INDEX IF NOT EXISTS idx_odoo_po_vendor ON odoo_purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_odoo_po_invoice_status ON odoo_purchase_orders(invoice_status) WHERE invoice_status != 'invoiced';
