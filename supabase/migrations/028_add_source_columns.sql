-- Migration 028: Add source column to vendors, customers, expenses
-- Prevents Odoo sync from overwriting manually-created records.
-- Also adds source-aware partial indexes for safer upserts.

-- Vendors: add source column
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- Backfill: existing vendors with odoo_id came from Odoo
UPDATE vendors SET source = 'odoo' WHERE odoo_id IS NOT NULL AND source = 'manual';

-- Customers: add source column
ALTER TABLE customers ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- Backfill: existing customers with odoo_id came from Odoo
UPDATE customers SET source = 'odoo' WHERE odoo_id IS NOT NULL AND source = 'manual';

-- Expenses: add source column
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- Backfill: existing expenses with odoo_id came from Odoo
UPDATE expenses SET source = 'odoo' WHERE odoo_id IS NOT NULL AND source = 'manual';
