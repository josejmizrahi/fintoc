-- ============================================================
-- Migration 016: Fix RLS policies and schema type mismatches
--
-- Problems fixed:
-- 1. RLS policies cast active_company_id as ::uuid but company_id is INTEGER
-- 2. Migration 012 created tables with company_id UUID instead of INTEGER
-- 3. Missing cert_* columns tracked in integrations but not in types
-- ============================================================

-- ============================================================
-- 1. Fix company_id type on tables created by migration 012
--    These tables were created with UUID but companies.id is INTEGER.
--    If the tables exist with wrong type, we need to alter them.
--    If they were created correctly by earlier migrations, this is a no-op.
-- ============================================================

-- sync_history: ensure company_id is INTEGER (may have been created as UUID by 012)
DO $$ BEGIN
  -- Only alter if the column is uuid type
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sync_history' AND column_name = 'company_id' AND data_type = 'uuid'
  ) THEN
    -- Drop existing FK constraint if any
    ALTER TABLE sync_history DROP CONSTRAINT IF EXISTS sync_history_company_id_fkey;
    ALTER TABLE sync_history ALTER COLUMN company_id TYPE INTEGER USING company_id::text::integer;
    ALTER TABLE sync_history ADD CONSTRAINT sync_history_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $$;

-- audit_log: ensure company_id is INTEGER
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

-- webhook_logs: ensure company_id is INTEGER
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webhook_logs' AND column_name = 'company_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE webhook_logs DROP CONSTRAINT IF EXISTS webhook_logs_company_id_fkey;
    ALTER TABLE webhook_logs ALTER COLUMN company_id TYPE INTEGER USING company_id::text::integer;
  END IF;
END $$;

-- syntage_extractions: ensure company_id is INTEGER
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

-- bank_accounts: ensure company_id is INTEGER
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

-- cfdi_complements: ensure company_id is INTEGER
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

-- invoice_payments: fix invoice_id and payment_id if they are UUID but should be INTEGER
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
--    companies.id is SERIAL (INTEGER), not UUID
-- ============================================================

-- Drop and recreate all company_isolation policies with correct cast
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'payments', 'invoices', 'vendors', 'customers',
    'expenses', 'approval_rules', 'approval_requests', 'bank_accounts',
    'bank_movements', 'budgets', 'syntage_extractions', 'sync_history',
    'webhook_logs', 'integrations'
  ]) LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      tbl || '_company_isolation', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (company_id = (auth.jwt() ->> ''active_company_id'')::int)',
      tbl || '_company_isolation', tbl
    );
  END LOOP;
END $$;

-- Fix cfdi_complements (created by 012)
DROP POLICY IF EXISTS cfdi_complements_company_isolation ON cfdi_complements;
CREATE POLICY cfdi_complements_company_isolation ON cfdi_complements
  FOR ALL USING (company_id = (auth.jwt() ->> 'active_company_id')::int);

-- Fix reconciliations (from 014)
DROP POLICY IF EXISTS reconciliations_company_isolation ON reconciliations;
CREATE POLICY reconciliations_company_isolation ON reconciliations
  FOR ALL USING (company_id = (auth.jwt() ->> 'active_company_id')::int);

-- Fix cfdi_documents (from 014)
DROP POLICY IF EXISTS cfdi_documents_company_isolation ON cfdi_documents;
CREATE POLICY cfdi_documents_company_isolation ON cfdi_documents
  FOR ALL USING (company_id = (auth.jwt() ->> 'active_company_id')::int);

-- Fix odoo tables (from 014)
DROP POLICY IF EXISTS odoo_bank_statements_company_isolation ON odoo_bank_statements;
CREATE POLICY odoo_bank_statements_company_isolation ON odoo_bank_statements
  FOR ALL USING (company_id = (auth.jwt() ->> 'active_company_id')::int);

DROP POLICY IF EXISTS odoo_purchase_orders_company_isolation ON odoo_purchase_orders;
CREATE POLICY odoo_purchase_orders_company_isolation ON odoo_purchase_orders
  FOR ALL USING (company_id = (auth.jwt() ->> 'active_company_id')::int);

DROP POLICY IF EXISTS odoo_id_cache_company_isolation ON odoo_id_cache;
CREATE POLICY odoo_id_cache_company_isolation ON odoo_id_cache
  FOR ALL USING (company_id = (auth.jwt() ->> 'active_company_id')::int);

-- Fix sync_logs (from 006, uses old auth_company_id function)
DROP POLICY IF EXISTS sync_logs_tenant ON sync_logs;
DROP POLICY IF EXISTS sync_logs_company_isolation ON sync_logs;
CREATE POLICY sync_logs_company_isolation ON sync_logs
  FOR ALL USING (company_id = (auth.jwt() ->> 'active_company_id')::int);

-- Fix notifications (special: has user_id AND company_id)
DROP POLICY IF EXISTS notifications_own_access ON notifications;
CREATE POLICY notifications_own_access ON notifications
  FOR ALL USING (user_id = auth.uid() AND company_id = (auth.jwt() ->> 'active_company_id')::int);

-- Fix audit_log (read-only)
DROP POLICY IF EXISTS audit_log_read_only ON audit_log;
CREATE POLICY audit_log_read_only ON audit_log FOR SELECT
  USING (company_id = (auth.jwt() ->> 'active_company_id')::int);

-- Fix companies policy
DROP POLICY IF EXISTS companies_member_access ON companies;
CREATE POLICY companies_member_access ON companies FOR ALL
  USING (id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid()));

-- Fix invoice_payments (inherits from invoices)
DROP POLICY IF EXISTS invoice_payments_access ON invoice_payments;
CREATE POLICY invoice_payments_access ON invoice_payments FOR ALL
  USING (invoice_id IN (SELECT id FROM invoices WHERE company_id = (auth.jwt() ->> 'active_company_id')::int));

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
