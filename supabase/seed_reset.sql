-- ============================================================
-- RESET: Truncate all application tables (preserves schema)
-- Run this in Supabase SQL Editor to wipe all data.
-- WARNING: This deletes ALL data including auth users.
-- ============================================================

-- First delete all auth users (this cascades to user_companies)
DELETE FROM auth.users;

-- Truncate all tables in dependency order
TRUNCATE TABLE
  audit_log,
  webhook_logs,
  webhook_events,
  sync_history,
  sync_logs,
  syntage_extractions,
  sat_cancellation_requests,
  sat_download_requests,
  rfc_validations,
  reconciliation_entries,
  reconciliations,
  cfdi_complements,
  invoice_payments,
  bank_movements,
  bank_accounts,
  odoo_bank_statements,
  odoo_purchase_orders,
  odoo_id_cache,
  notifications,
  approval_requests,
  approval_rules,
  budgets,
  expenses,
  payments,
  invoices,
  cfdi_documents,
  customers,
  vendors,
  integrations,
  user_companies,
  companies
CASCADE;

-- Reset sequences for SERIAL columns
ALTER SEQUENCE IF EXISTS companies_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS payments_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS invoices_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS vendors_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS customers_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS expenses_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS approval_rules_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS approval_requests_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS budgets_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS notifications_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS reconciliations_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS cfdi_documents_id_seq RESTART WITH 1;

-- Verify everything is clean
SELECT 'companies' AS table_name, count(*) FROM companies
UNION ALL SELECT 'user_companies', count(*) FROM user_companies
UNION ALL SELECT 'payments', count(*) FROM payments
UNION ALL SELECT 'invoices', count(*) FROM invoices
UNION ALL SELECT 'vendors', count(*) FROM vendors
UNION ALL SELECT 'customers', count(*) FROM customers;
