-- Phase 4: Remove Odoo auxiliary tables.
-- Reconciliation is delegated to Odoo; purchase orders and id cache are no longer used.

DROP TABLE IF EXISTS odoo_bank_statements CASCADE;
DROP TABLE IF EXISTS odoo_purchase_orders CASCADE;
DROP TABLE IF EXISTS odoo_id_cache CASCADE;
