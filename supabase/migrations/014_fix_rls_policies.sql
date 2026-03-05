-- Migration 014: Fix RLS Policies
-- Fixes critical security issues:
-- 1. Odoo tables with policies that allow access to ALL companies
-- 2. INSERT policies that allow any authenticated user to insert into any company
-- 3. Remove duplicate/stale policies (standardize on JWT active_company_id approach)

-- ============================================================
-- 1. Fix odoo_bank_statements: broken policy allows all companies
-- ============================================================
DROP POLICY IF EXISTS odoo_bank_statements_tenant ON odoo_bank_statements;
CREATE POLICY odoo_bank_statements_company_isolation ON odoo_bank_statements
  FOR ALL USING (company_id = (auth.jwt() ->> 'active_company_id')::uuid);

-- ============================================================
-- 2. Fix odoo_purchase_orders: broken policy allows all companies
-- ============================================================
DROP POLICY IF EXISTS odoo_purchase_orders_tenant ON odoo_purchase_orders;
CREATE POLICY odoo_purchase_orders_company_isolation ON odoo_purchase_orders
  FOR ALL USING (company_id = (auth.jwt() ->> 'active_company_id')::uuid);

-- ============================================================
-- 3. Fix odoo_id_cache: broken policy allows all companies
-- ============================================================
DROP POLICY IF EXISTS odoo_id_cache_tenant ON odoo_id_cache;
CREATE POLICY odoo_id_cache_company_isolation ON odoo_id_cache
  FOR ALL USING (company_id = (auth.jwt() ->> 'active_company_id')::uuid);

-- ============================================================
-- 4. Fix INSERT policies: restrict to own company
-- ============================================================

-- integrations: restrict insert to own company
DROP POLICY IF EXISTS integrations_insert ON integrations;

-- bank_movements: restrict insert to own company
DROP POLICY IF EXISTS bank_movements_insert ON bank_movements;

-- audit_log: restrict insert (keep open for service role, which bypasses RLS anyway)
DROP POLICY IF EXISTS audit_log_insert ON audit_log;

-- reconciliation_entries: restrict insert to own company
DROP POLICY IF EXISTS reconciliation_entries_insert ON reconciliation_entries;

-- sync_logs: restrict insert to own company
DROP POLICY IF EXISTS sync_logs_insert ON sync_logs;

-- webhook_events: restrict insert
DROP POLICY IF EXISTS webhook_events_insert ON webhook_events;

-- ============================================================
-- 5. Remove duplicate old-style policies (auth_company_id)
-- Standardize on JWT active_company_id from migration 012
-- ============================================================

-- These old policies use auth_company_id() which queries the users table.
-- The new JWT-based policies are more efficient and don't require the extra query.
DROP POLICY IF EXISTS payments_tenant ON payments;
DROP POLICY IF EXISTS invoices_tenant ON invoices;
DROP POLICY IF EXISTS vendors_tenant ON vendors;
DROP POLICY IF EXISTS customers_tenant ON customers;
DROP POLICY IF EXISTS expenses_tenant ON expenses;
DROP POLICY IF EXISTS approval_rules_tenant ON approval_rules;
DROP POLICY IF EXISTS approval_requests_tenant ON approval_requests;
DROP POLICY IF EXISTS budgets_tenant ON budgets;
DROP POLICY IF EXISTS notifications_tenant ON notifications;
DROP POLICY IF EXISTS reconciliations_tenant ON reconciliations;
DROP POLICY IF EXISTS cfdi_documents_tenant ON cfdi_documents;
DROP POLICY IF EXISTS audit_log_tenant ON audit_log;
DROP POLICY IF EXISTS companies_own ON companies;

-- Add JWT-based policies for tables that only had old-style policies
DROP POLICY IF EXISTS reconciliations_company_isolation ON reconciliations;
CREATE POLICY reconciliations_company_isolation ON reconciliations
  FOR ALL USING (company_id = (auth.jwt() ->> 'active_company_id')::uuid);

DROP POLICY IF EXISTS cfdi_documents_company_isolation ON cfdi_documents;
CREATE POLICY cfdi_documents_company_isolation ON cfdi_documents
  FOR ALL USING (company_id = (auth.jwt() ->> 'active_company_id')::uuid);

-- ============================================================
-- 6. Keep the auth_company_id() function for backward compatibility
-- but it's no longer used in policies
-- ============================================================
