-- ============================================================
-- Migration 016: Fix RLS policies and schema type mismatches
--
-- Problems fixed:
-- 1. RLS policies cast active_company_id as ::uuid but company_id is INTEGER
-- 2. Migration 012 created tables with company_id UUID instead of INTEGER
-- 3. Creates missing tables that failed to create in migration 012
-- ============================================================

-- ============================================================
-- 0. Create tables that migration 012 failed to create (UUID FK mismatch)
--    Now with correct INTEGER company_id
-- ============================================================

CREATE TABLE IF NOT EXISTS bank_accounts (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  fintoc_account_id VARCHAR(100) NOT NULL,
  clabe VARCHAR(18) NOT NULL,
  bank_name VARCHAR(100),
  account_holder VARCHAR(200),
  balance DECIMAL(15,2),
  currency VARCHAR(3) NOT NULL DEFAULT 'MXN',
  last_synced TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS invoice_payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  amount DECIMAL(15,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_unique ON invoice_payments(invoice_id, payment_id);
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS cfdi_complements (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  uuid VARCHAR(36),
  amount DECIMAL(15,2) NOT NULL,
  payment_date DATE NOT NULL,
  xml_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE cfdi_complements ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS syntage_extractions (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  syntage_extraction_id VARCHAR(100) NOT NULL,
  extractor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  records_found INTEGER,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE syntage_extractions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS sync_history (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  records_synced INTEGER,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE sync_history ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  changes JSONB,
  metadata JSONB,
  user_email TEXT,
  description TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(company_id, action, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id SERIAL PRIMARY KEY,
  company_id INTEGER,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_wh_unprocessed
  ON webhook_logs(provider, processed) WHERE processed = false;

-- ============================================================
-- 1. Fix company_id type on tables that may have been created
--    with UUID by migration 012 (only runs if column is uuid)
-- ============================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sync_history' AND column_name = 'company_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE sync_history DROP CONSTRAINT IF EXISTS sync_history_company_id_fkey;
    ALTER TABLE sync_history ALTER COLUMN company_id TYPE INTEGER USING company_id::text::integer;
    ALTER TABLE sync_history ADD CONSTRAINT sync_history_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_log' AND column_name = 'company_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_company_id_fkey;
    ALTER TABLE audit_log ALTER COLUMN company_id TYPE INTEGER USING company_id::text::integer;
    ALTER TABLE audit_log ADD CONSTRAINT audit_log_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webhook_logs' AND column_name = 'company_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE webhook_logs DROP CONSTRAINT IF EXISTS webhook_logs_company_id_fkey;
    ALTER TABLE webhook_logs ALTER COLUMN company_id TYPE INTEGER USING company_id::text::integer;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'syntage_extractions' AND column_name = 'company_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE syntage_extractions DROP CONSTRAINT IF EXISTS syntage_extractions_company_id_fkey;
    ALTER TABLE syntage_extractions ALTER COLUMN company_id TYPE INTEGER USING company_id::text::integer;
    ALTER TABLE syntage_extractions ADD CONSTRAINT syntage_extractions_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bank_accounts' AND column_name = 'company_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE bank_accounts DROP CONSTRAINT IF EXISTS bank_accounts_company_id_fkey;
    ALTER TABLE bank_accounts ALTER COLUMN company_id TYPE INTEGER USING company_id::text::integer;
    ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cfdi_complements' AND column_name = 'company_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE cfdi_complements DROP CONSTRAINT IF EXISTS cfdi_complements_company_id_fkey;
    ALTER TABLE cfdi_complements ALTER COLUMN company_id TYPE INTEGER USING company_id::text::integer;
    ALTER TABLE cfdi_complements ADD CONSTRAINT cfdi_complements_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_payments' AND column_name = 'invoice_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS invoice_payments_invoice_id_fkey;
    ALTER TABLE invoice_payments ALTER COLUMN invoice_id TYPE INTEGER USING invoice_id::text::integer;
    ALTER TABLE invoice_payments ADD CONSTRAINT invoice_payments_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES invoices(id);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_payments' AND column_name = 'payment_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS invoice_payments_payment_id_fkey;
    ALTER TABLE invoice_payments ALTER COLUMN payment_id TYPE INTEGER USING payment_id::text::integer;
    ALTER TABLE invoice_payments ADD CONSTRAINT invoice_payments_payment_id_fkey
      FOREIGN KEY (payment_id) REFERENCES payments(id);
  END IF;
END $$;

-- ============================================================
-- 2. Fix ALL RLS policies to use ::int instead of ::uuid
--    Only operate on tables that actually exist
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'payments', 'invoices', 'vendors', 'customers',
    'expenses', 'approval_rules', 'approval_requests', 'bank_accounts',
    'bank_movements', 'budgets', 'syntage_extractions', 'sync_history',
    'webhook_logs', 'integrations', 'cfdi_complements', 'reconciliations',
    'cfdi_documents'
  ]) LOOP
    -- Only process tables that exist
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON %I',
        tbl || '_company_isolation', tbl
      );
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL USING (company_id = (auth.jwt() ->> ''active_company_id'')::int)',
        tbl || '_company_isolation', tbl
      );
    END IF;
  END LOOP;
END $$;

-- Fix odoo tables (only if they exist)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'odoo_bank_statements', 'odoo_purchase_orders', 'odoo_id_cache'
  ]) LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON %I',
        tbl || '_company_isolation', tbl
      );
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL USING (company_id = (auth.jwt() ->> ''active_company_id'')::int)',
        tbl || '_company_isolation', tbl
      );
    END IF;
  END LOOP;
END $$;

-- Fix sync_logs (remove old auth_company_id policy)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sync_logs') THEN
    DROP POLICY IF EXISTS sync_logs_tenant ON sync_logs;
    DROP POLICY IF EXISTS sync_logs_company_isolation ON sync_logs;
    CREATE POLICY sync_logs_company_isolation ON sync_logs
      FOR ALL USING (company_id = (auth.jwt() ->> 'active_company_id')::int);
  END IF;
END $$;

-- Fix notifications (special: has user_id AND company_id)
DROP POLICY IF EXISTS notifications_own_access ON notifications;
CREATE POLICY notifications_own_access ON notifications
  FOR ALL USING (user_id = auth.uid() AND company_id = (auth.jwt() ->> 'active_company_id')::int);

-- Fix audit_log (read-only)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_log') THEN
    DROP POLICY IF EXISTS audit_log_read_only ON audit_log;
    CREATE POLICY audit_log_read_only ON audit_log FOR SELECT
      USING (company_id = (auth.jwt() ->> 'active_company_id')::int);
  END IF;
END $$;

-- Fix companies policy
DROP POLICY IF EXISTS companies_member_access ON companies;
CREATE POLICY companies_member_access ON companies FOR ALL
  USING (id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid()));

-- Fix invoice_payments (inherits from invoices)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'invoice_payments') THEN
    DROP POLICY IF EXISTS invoice_payments_access ON invoice_payments;
    CREATE POLICY invoice_payments_access ON invoice_payments FOR ALL
      USING (invoice_id IN (SELECT id FROM invoices WHERE company_id = (auth.jwt() ->> 'active_company_id')::int));
  END IF;
END $$;

-- ============================================================
-- 3. Update custom_access_token_hook to set company_id as integer
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
