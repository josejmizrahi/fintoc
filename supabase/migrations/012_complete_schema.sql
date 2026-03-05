-- Complete schema migration per specification v1.0
-- This migration ensures all 20 tables exist with correct columns, RLS, and indexes

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- 1. COMPANIES (update existing)
-- ============================================================
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone VARCHAR(15);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Auto-update trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS companies_updated_at ON companies;
CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 2. USER_COMPANIES (update existing)
-- ============================================================
ALTER TABLE user_companies ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE user_companies ADD COLUMN IF NOT EXISTS invited_by UUID;
ALTER TABLE user_companies ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
ALTER TABLE user_companies ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

-- Update role check constraint if needed
DO $$ BEGIN
  ALTER TABLE user_companies DROP CONSTRAINT IF EXISTS user_companies_role_check;
  ALTER TABLE user_companies ADD CONSTRAINT user_companies_role_check
    CHECK (role IN ('admin', 'accountant', 'viewer'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE user_companies ADD CONSTRAINT user_companies_status_check
    CHECK (status IN ('active', 'invited', 'deactivated'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Only one active company per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_uc_active ON user_companies(user_id) WHERE is_active = true;

-- ============================================================
-- 3. INTEGRATIONS (update existing)
-- ============================================================
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS config_encrypted BYTEA;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS syntage_credential_id VARCHAR(100);
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS syntage_taxpayer_id VARCHAR(100);
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS last_sync TIMESTAMPTZ;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS sync_errors JSONB;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_provider ON integrations(company_id, provider);

-- ============================================================
-- 4. PAYMENTS (recreate with spec columns)
-- ============================================================
-- Add new columns to existing payments table
ALTER TABLE payments ADD COLUMN IF NOT EXISTS vendor_id UUID;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_id UUID;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS beneficiary_name VARCHAR(200);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS clabe VARCHAR(18);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS concept VARCHAR(40);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference VARCHAR(7);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS scheduled_date DATE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fintoc_error TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS odoo_payment_id VARCHAR(50);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS odoo_synced_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DROP TRIGGER IF EXISTS payments_updated_at ON payments;
CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_payments_company_status ON payments(company_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_vendor ON payments(vendor_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_fintoc ON payments(fintoc_transfer_id) WHERE fintoc_transfer_id IS NOT NULL;

-- ============================================================
-- 5. INVOICES (update with spec columns)
-- ============================================================
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vendor_id UUID;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_id UUID;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS uuid VARCHAR(36);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issuer_rfc VARCHAR(13);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receiver_rfc VARCHAR(13);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(15,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'MXN';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS efos_status TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancellable BOOLEAN;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xml_url TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS odoo_move_id VARCHAR(50);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS syntage_invoice_id VARCHAR(100);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DROP TRIGGER IF EXISTS invoices_updated_at ON invoices;
CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_uuid ON invoices(uuid) WHERE uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_type_status ON invoices(company_id, type, sat_status);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date) WHERE amount_residual > 0;
CREATE INDEX IF NOT EXISTS idx_invoices_odoo ON invoices(odoo_move_id) WHERE odoo_move_id IS NOT NULL;

-- ============================================================
-- 6. INVOICE_PAYMENTS (new table)
-- ============================================================
CREATE TABLE IF NOT EXISTS invoice_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  payment_id UUID NOT NULL REFERENCES payments(id),
  amount DECIMAL(15,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_unique ON invoice_payments(invoice_id, payment_id);

-- ============================================================
-- 7. CFDI_COMPLEMENTS (new table)
-- ============================================================
CREATE TABLE IF NOT EXISTS cfdi_complements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  payment_id UUID NOT NULL REFERENCES payments(id),
  uuid VARCHAR(36),
  amount DECIMAL(15,2) NOT NULL,
  payment_date DATE NOT NULL,
  xml_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 8. VENDORS (update with spec columns)
-- ============================================================
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS rfc_validated BOOLEAN DEFAULT false;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS clabe_verified BOOLEAN DEFAULT false;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS clabe_holder_name VARCHAR(200);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_name VARCHAR(100);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS efos_status TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS odoo_id VARCHAR(50);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DROP TRIGGER IF EXISTS vendors_updated_at ON vendors;
CREATE TRIGGER vendors_updated_at
  BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_rfc ON vendors(company_id, rfc);
CREATE INDEX IF NOT EXISTS idx_vendors_efos ON vendors(efos_status) WHERE efos_status IS NOT NULL;

-- ============================================================
-- 9. CUSTOMERS (update with spec columns)
-- ============================================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS fintoc_clabe VARCHAR(18);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS fintoc_account_id VARCHAR(100);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS odoo_id VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DROP TRIGGER IF EXISTS customers_updated_at ON customers;
CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_rfc ON customers(company_id, rfc);

-- ============================================================
-- 10. EXPENSES (update existing)
-- ============================================================
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS xml_url TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS rejected_reason TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS created_by UUID;

-- ============================================================
-- 11. APPROVAL_RULES (ensure exists)
-- ============================================================
-- Already exists, ensure columns match
ALTER TABLE approval_rules ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

-- ============================================================
-- 12. APPROVAL_REQUESTS (update)
-- ============================================================
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS entity_type TEXT DEFAULT 'payment';
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS entity_id UUID;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS rule_id UUID;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS amount DECIMAL(15,2);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS requested_by UUID;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS resolved_by UUID;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- ============================================================
-- 13. BANK_ACCOUNTS (ensure exists with all columns)
-- ============================================================
CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  fintoc_account_id VARCHAR(100) NOT NULL,
  clabe VARCHAR(18) NOT NULL,
  bank_name VARCHAR(100),
  account_holder VARCHAR(200),
  balance DECIMAL(15,2),
  currency VARCHAR(3) NOT NULL DEFAULT 'MXN',
  last_synced TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 14. BANK_MOVEMENTS (update existing)
-- ============================================================
ALTER TABLE bank_movements ADD COLUMN IF NOT EXISTS account_id UUID;
ALTER TABLE bank_movements ADD COLUMN IF NOT EXISTS fintoc_movement_id VARCHAR(100);
ALTER TABLE bank_movements ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE bank_movements ADD COLUMN IF NOT EXISTS balance_after DECIMAL(15,2);
ALTER TABLE bank_movements ADD COLUMN IF NOT EXISTS reconciled BOOLEAN DEFAULT false;
ALTER TABLE bank_movements ADD COLUMN IF NOT EXISTS reconciled_payment_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bm_fintoc ON bank_movements(fintoc_movement_id) WHERE fintoc_movement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bm_date ON bank_movements(company_id, date DESC);

-- ============================================================
-- 15. BUDGETS (ensure columns match)
-- ============================================================
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS category VARCHAR(100);
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS period_start DATE;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS period_end DATE;

-- ============================================================
-- 16. SYNTAGE_EXTRACTIONS (new table)
-- ============================================================
CREATE TABLE IF NOT EXISTS syntage_extractions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  syntage_extraction_id VARCHAR(100) NOT NULL,
  extractor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  records_found INTEGER,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- 17. NOTIFICATIONS (update existing)
-- ============================================================
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_id UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_notif_user_unread
  ON notifications(user_id, company_id) WHERE read = false;

-- Enable Realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- ============================================================
-- 18. AUDIT_LOG (ensure exists)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  changes JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(company_id, action, created_at DESC);

-- ============================================================
-- 19. SYNC_HISTORY (ensure exists with spec columns)
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  records_synced INTEGER,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- 20. WEBHOOK_LOGS (new table)
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wh_unprocessed
  ON webhook_logs(provider, processed) WHERE processed = false;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfdi_complements ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE syntage_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

-- Company-scoped RLS policies (using JWT active_company_id claim)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'payments', 'invoices', 'cfdi_complements', 'vendors', 'customers',
    'expenses', 'approval_rules', 'approval_requests', 'bank_accounts',
    'bank_movements', 'budgets', 'syntage_extractions', 'sync_history',
    'webhook_logs', 'integrations'
  ]) LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      tbl || '_company_isolation', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (company_id = (auth.jwt() ->> ''active_company_id'')::uuid)',
      tbl || '_company_isolation', tbl
    );
  END LOOP;
END $$;

-- Special policies
DROP POLICY IF EXISTS companies_member_access ON companies;
CREATE POLICY companies_member_access ON companies FOR ALL
  USING (id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS user_companies_own_access ON user_companies;
CREATE POLICY user_companies_own_access ON user_companies FOR ALL
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_own_access ON notifications;
CREATE POLICY notifications_own_access ON notifications FOR ALL
  USING (user_id = auth.uid() AND company_id = (auth.jwt() ->> 'active_company_id')::uuid);

DROP POLICY IF EXISTS audit_log_company_isolation ON audit_log;
CREATE POLICY audit_log_read_only ON audit_log FOR SELECT
  USING (company_id = (auth.jwt() ->> 'active_company_id')::uuid);

-- Invoice payments inherits from invoices
DROP POLICY IF EXISTS invoice_payments_access ON invoice_payments;
CREATE POLICY invoice_payments_access ON invoice_payments FOR ALL
  USING (invoice_id IN (SELECT id FROM invoices WHERE company_id = (auth.jwt() ->> 'active_company_id')::uuid));

-- ============================================================
-- CUSTOM ACCESS TOKEN HOOK (for active_company_id claim)
-- ============================================================
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb AS $$
  SELECT jsonb_set(
    event,
    '{claims,active_company_id}',
    COALESCE(
      to_jsonb((
        SELECT company_id::text FROM user_companies
        WHERE user_id = (event->>'user_id')::uuid AND is_active = true
        LIMIT 1
      )),
      'null'::jsonb
    )
  );
$$ LANGUAGE sql STABLE;
