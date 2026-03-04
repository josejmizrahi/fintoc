-- ══════════════════════════════════════════════════════════
-- Migration 002: Supabase Auth + Row Level Security
-- Run this in the Supabase SQL Editor AFTER migration 001
-- ══════════════════════════════════════════════════════════

-- Add auth_uid column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'auth_uid'
  ) THEN
    ALTER TABLE users ADD COLUMN auth_uid UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Helper function: get the company_id for the current authenticated user
CREATE OR REPLACE FUNCTION auth_company_id() RETURNS INTEGER AS $$
  SELECT company_id FROM public.users WHERE auth_uid = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ══════════════════════════════════════════════════════════
-- Enable RLS on all tables
-- ══════════════════════════════════════════════════════════

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfdi_documents ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════
-- RLS Policies (DROP IF EXISTS + CREATE for idempotency)
-- ══════════════════════════════════════════════════════════

-- Users: can see own profile
DROP POLICY IF EXISTS users_own ON users;
CREATE POLICY users_own ON users
  FOR ALL USING (auth_uid = auth.uid());

-- Companies: users can see their own company
DROP POLICY IF EXISTS companies_own ON companies;
CREATE POLICY companies_own ON companies
  FOR ALL USING (id = auth_company_id());

-- Tenant-scoped tables
DROP POLICY IF EXISTS payments_tenant ON payments;
CREATE POLICY payments_tenant ON payments
  FOR ALL USING (company_id = auth_company_id());

DROP POLICY IF EXISTS invoices_tenant ON invoices;
CREATE POLICY invoices_tenant ON invoices
  FOR ALL USING (company_id = auth_company_id());

DROP POLICY IF EXISTS vendors_tenant ON vendors;
CREATE POLICY vendors_tenant ON vendors
  FOR ALL USING (company_id = auth_company_id());

DROP POLICY IF EXISTS customers_tenant ON customers;
CREATE POLICY customers_tenant ON customers
  FOR ALL USING (company_id = auth_company_id());

DROP POLICY IF EXISTS expenses_tenant ON expenses;
CREATE POLICY expenses_tenant ON expenses
  FOR ALL USING (company_id = auth_company_id());

DROP POLICY IF EXISTS approval_rules_tenant ON approval_rules;
CREATE POLICY approval_rules_tenant ON approval_rules
  FOR ALL USING (company_id = auth_company_id());

DROP POLICY IF EXISTS approval_requests_tenant ON approval_requests;
CREATE POLICY approval_requests_tenant ON approval_requests
  FOR ALL USING (company_id = auth_company_id());

DROP POLICY IF EXISTS budgets_tenant ON budgets;
CREATE POLICY budgets_tenant ON budgets
  FOR ALL USING (company_id = auth_company_id());

DROP POLICY IF EXISTS notifications_tenant ON notifications;
CREATE POLICY notifications_tenant ON notifications
  FOR ALL USING (company_id = auth_company_id());

DROP POLICY IF EXISTS reconciliations_tenant ON reconciliations;
CREATE POLICY reconciliations_tenant ON reconciliations
  FOR ALL USING (company_id = auth_company_id());

DROP POLICY IF EXISTS cfdi_documents_tenant ON cfdi_documents;
CREATE POLICY cfdi_documents_tenant ON cfdi_documents
  FOR ALL USING (company_id = auth_company_id());

-- Allow service_role to bypass RLS (it does by default, but be explicit)
-- Allow inserts during registration (companies + users need INSERT before auth_company_id works)
DROP POLICY IF EXISTS companies_insert ON companies;
CREATE POLICY companies_insert ON companies
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS users_insert ON users;
CREATE POLICY users_insert ON users
  FOR INSERT WITH CHECK (true);
