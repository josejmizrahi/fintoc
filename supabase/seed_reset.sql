-- ============================================================
-- RESET: Truncate all application tables (preserves schema)
-- Run this in Supabase SQL Editor to wipe all data.
-- WARNING: This deletes ALL data including auth users.
-- Safe to run even if some tables don't exist yet.
-- ============================================================

-- First delete all auth users (cascades to user_companies via FK)
DELETE FROM auth.users;

-- Truncate each table individually, skipping if it doesn't exist
DO $$
DECLARE
  tables TEXT[] := ARRAY[
    'audit_log',
    'webhook_logs',
    'webhook_events',
    'sync_history',
    'sync_logs',
    'syntage_extractions',
    'sat_cancellation_requests',
    'sat_download_requests',
    'rfc_validations',
    'reconciliation_entries',
    'reconciliations',
    'cfdi_complements',
    'invoice_payments',
    'bank_movements',
    'bank_accounts',
    'odoo_bank_statements',
    'odoo_purchase_orders',
    'odoo_id_cache',
    'notifications',
    'approval_requests',
    'approval_rules',
    'budgets',
    'expenses',
    'payments',
    'invoices',
    'cfdi_documents',
    'customers',
    'vendors',
    'integrations',
    'user_companies',
    'users',
    'companies'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('TRUNCATE TABLE public.%I CASCADE', t);
      RAISE NOTICE 'Truncated: %', t;
    ELSE
      RAISE NOTICE 'Skipped (not found): %', t;
    END IF;
  END LOOP;
END $$;

-- Reset sequences (IF EXISTS handles missing ones)
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
