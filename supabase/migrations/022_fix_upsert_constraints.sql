-- ============================================================
-- Migration 022: Fix unique constraints for ON CONFLICT upsert
-- The partial unique indexes (WHERE col IS NOT NULL) don't work
-- with PostgreSQL ON CONFLICT. Replace with proper constraints.
-- ============================================================

-- 1. Invoices: fix (company_id, odoo_id) and (company_id, uuid)
DROP INDEX IF EXISTS idx_invoices_odoo;
DROP INDEX IF EXISTS idx_invoices_uuid;

-- Clean duplicate UUIDs
WITH duplicates AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, uuid ORDER BY updated_at DESC NULLS LAST, id DESC) as rn
  FROM invoices WHERE uuid IS NOT NULL
)
UPDATE invoices SET uuid = NULL WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

ALTER TABLE invoices ADD CONSTRAINT invoices_company_odoo_id_unique UNIQUE (company_id, odoo_id);
ALTER TABLE invoices ADD CONSTRAINT invoices_company_uuid_unique UNIQUE (company_id, uuid);
CREATE INDEX IF NOT EXISTS idx_invoices_odoo_move ON invoices (odoo_move_id) WHERE odoo_move_id IS NOT NULL;

-- 2. Fix webhook_logs.payload to allow NULL
ALTER TABLE webhook_logs ALTER COLUMN payload DROP NOT NULL;

-- 3. Add missing columns for cancel and webhook features
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancel_motivo text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancel_uuid_sustituto text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issuer_name text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receiver_name text;

-- 4. Vendors: fix (company_id, rfc) and (company_id, odoo_id)
DROP INDEX IF EXISTS idx_vendors_rfc;
DROP INDEX IF EXISTS idx_vendors_odoo;

WITH duplicates AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, rfc ORDER BY updated_at DESC NULLS LAST, id DESC) as rn
  FROM vendors WHERE rfc IS NOT NULL
)
UPDATE vendors SET rfc = rfc || '_dup_' || id WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

ALTER TABLE vendors ADD CONSTRAINT vendors_company_rfc_unique UNIQUE (company_id, rfc);
ALTER TABLE vendors ADD CONSTRAINT vendors_company_odoo_id_unique UNIQUE (company_id, odoo_id);

-- 5. Customers: fix (company_id, rfc) and (company_id, odoo_id)
DROP INDEX IF EXISTS idx_customers_rfc;
DROP INDEX IF EXISTS idx_customers_odoo;

WITH duplicates AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, rfc ORDER BY updated_at DESC NULLS LAST, id DESC) as rn
  FROM customers WHERE rfc IS NOT NULL
)
UPDATE customers SET rfc = rfc || '_dup_' || id WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

ALTER TABLE customers ADD CONSTRAINT customers_company_rfc_unique UNIQUE (company_id, rfc);
ALTER TABLE customers ADD CONSTRAINT customers_company_odoo_id_unique UNIQUE (company_id, odoo_id);
