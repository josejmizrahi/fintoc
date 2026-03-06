-- ============================================================
-- Migration 016: FULL SCHEMA RESET
-- Drops all tables and recreates from scratch with correct types.
-- All company_id columns are INTEGER (companies.id is SERIAL).
-- All RLS policies use ::int cast for active_company_id.
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- DROP ALL TABLES (reverse dependency order)
-- ============================================================

DROP TABLE IF EXISTS webhook_logs CASCADE;
DROP TABLE IF EXISTS webhook_events CASCADE;
DROP TABLE IF EXISTS sync_history CASCADE;
DROP TABLE IF EXISTS sync_logs CASCADE;
DROP TABLE IF EXISTS syntage_extractions CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS rfc_validations CASCADE;
DROP TABLE IF EXISTS sat_cancellation_requests CASCADE;
DROP TABLE IF EXISTS sat_download_requests CASCADE;
DROP TABLE IF EXISTS odoo_id_cache CASCADE;
DROP TABLE IF EXISTS odoo_purchase_orders CASCADE;
DROP TABLE IF EXISTS odoo_bank_statements CASCADE;
DROP TABLE IF EXISTS invoice_payments CASCADE;
DROP TABLE IF EXISTS cfdi_complements CASCADE;
DROP TABLE IF EXISTS reconciliation_entries CASCADE;
DROP TABLE IF EXISTS bank_movements CASCADE;
DROP TABLE IF EXISTS bank_accounts CASCADE;
DROP TABLE IF EXISTS approval_requests CASCADE;
DROP TABLE IF EXISTS approval_rules CASCADE;
DROP TABLE IF EXISTS budgets CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS cfdi_documents CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS vendors CASCADE;
DROP TABLE IF EXISTS reconciliations CASCADE;
DROP TABLE IF EXISTS integrations CASCADE;
DROP TABLE IF EXISTS user_companies CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS companies CASCADE;

-- Drop old helper function
DROP FUNCTION IF EXISTS auth_company_id();

-- ============================================================
-- AUTO-UPDATE TRIGGER FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. COMPANIES
-- ============================================================

CREATE TABLE companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  rfc TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  onboarding_completed BOOLEAN DEFAULT false,
  address TEXT,
  phone VARCHAR(15),
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 2. USERS (linked to Supabase Auth)
-- ============================================================

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  auth_uid UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT 'SUPABASE_AUTH',
  name TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  company_id INTEGER REFERENCES companies(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Legacy helper (kept for backward compat, not used in policies)
CREATE OR REPLACE FUNCTION auth_company_id() RETURNS INTEGER AS $$
  SELECT company_id FROM public.users WHERE auth_uid = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- 3. USER_COMPANIES (multi-tenant)
-- ============================================================

CREATE TABLE user_companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer',
  is_active BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  invited_by UUID,
  invited_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_companies_role_check CHECK (role IN ('admin', 'accountant', 'viewer')),
  CONSTRAINT user_companies_status_check CHECK (status IN ('active', 'invited', 'deactivated')),
  CONSTRAINT user_companies_unique UNIQUE (user_id, company_id)
);

CREATE UNIQUE INDEX idx_uc_active ON user_companies(user_id) WHERE is_active = true;
CREATE INDEX idx_uc_company ON user_companies(company_id);

-- ============================================================
-- 4. INTEGRATIONS
-- ============================================================

CREATE TABLE integrations (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('odoo', 'fintoc', 'sat', 'general')),
  is_connected BOOLEAN DEFAULT false,
  config JSONB DEFAULT '{}',
  config_encrypted BYTEA,
  syntage_credential_id VARCHAR(100),
  syntage_taxpayer_id VARCHAR(100),
  last_sync TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_message TEXT,
  sync_errors JSONB,
  status TEXT DEFAULT 'pending',
  cert_serial TEXT,
  cert_expires_at TIMESTAMPTZ,
  cert_uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, provider)
);

CREATE INDEX idx_integration_provider ON integrations(company_id, provider);

-- ============================================================
-- 5. VENDORS
-- ============================================================

CREATE TABLE vendors (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rfc TEXT,
  email TEXT,
  clabe TEXT,
  is_active BOOLEAN DEFAULT true,
  rfc_validated BOOLEAN DEFAULT false,
  rfc_validated_at TIMESTAMPTZ,
  clabe_verified BOOLEAN DEFAULT false,
  clabe_holder_name VARCHAR(200),
  bank_name VARCHAR(100),
  efos_status TEXT DEFAULT 'unknown',
  efos_checked_at TIMESTAMPTZ,
  odoo_id VARCHAR(50),
  synced_at TIMESTAMPTZ,
  phone TEXT,
  regimen_fiscal TEXT,
  supplier_rank INTEGER DEFAULT 0,
  payment_term TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_vendors_rfc ON vendors(company_id, rfc);
CREATE UNIQUE INDEX idx_vendors_odoo ON vendors(company_id, odoo_id) WHERE odoo_id IS NOT NULL;
CREATE INDEX idx_vendors_efos ON vendors(efos_status) WHERE efos_status IS NOT NULL;

CREATE TRIGGER vendors_updated_at
  BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 6. CUSTOMERS
-- ============================================================

CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rfc TEXT,
  email TEXT,
  clabe TEXT,
  is_active BOOLEAN DEFAULT true,
  rfc_validated BOOLEAN DEFAULT false,
  rfc_validated_at TIMESTAMPTZ,
  fintoc_clabe VARCHAR(18),
  fintoc_account_id VARCHAR(100),
  fintoc_account_number_id TEXT,
  odoo_id VARCHAR(50),
  phone TEXT,
  regimen_fiscal TEXT,
  customer_rank INTEGER DEFAULT 0,
  payment_term TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_customers_rfc ON customers(company_id, rfc);
CREATE UNIQUE INDEX idx_customers_odoo ON customers(company_id, odoo_id) WHERE odoo_id IS NOT NULL;
CREATE UNIQUE INDEX idx_customers_fintoc_an ON customers(fintoc_account_number_id) WHERE fintoc_account_number_id IS NOT NULL;

CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 7. INVOICES
-- ============================================================

CREATE TABLE invoices (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT,
  partner_name TEXT,
  partner_rfc TEXT,
  amount_total NUMERIC(15,2) DEFAULT 0,
  amount_residual NUMERIC(15,2) DEFAULT 0,
  amount_paid DECIMAL(15,2) DEFAULT 0,
  amount_tax DECIMAL(15,2) DEFAULT 0,
  date_invoice DATE,
  date_due DATE,
  status TEXT DEFAULT 'open',
  cfdi_uuid TEXT,
  name TEXT,
  source TEXT DEFAULT 'manual',
  sat_status TEXT,
  payment_status TEXT,
  payment_state TEXT,
  vendor_id INTEGER REFERENCES vendors(id),
  customer_id INTEGER REFERENCES customers(id),
  invoice_number VARCHAR(50),
  uuid VARCHAR(36),
  issuer_rfc VARCHAR(13),
  receiver_rfc VARCHAR(13),
  invoice_date DATE,
  due_date DATE,
  currency VARCHAR(3) DEFAULT 'MXN',
  payment_method TEXT,
  payment_policy TEXT CHECK (payment_policy IN ('PUE', 'PPD')),
  efos_status TEXT,
  cancellable BOOLEAN,
  xml_url TEXT,
  odoo_id INTEGER,
  odoo_move_id VARCHAR(50),
  odoo_cfdi_uuid TEXT,
  odoo_payment_method TEXT,
  odoo_usage TEXT,
  move_type TEXT,
  invoice_line_count INTEGER DEFAULT 0,
  fintoc_institution_id TEXT,
  syntage_invoice_id VARCHAR(100),
  -- SAT CFDI 4.0 fields
  tipo_comprobante TEXT,
  metodo_pago TEXT,
  forma_pago TEXT,
  moneda TEXT DEFAULT 'MXN',
  tipo_cambio NUMERIC(15,6) DEFAULT 1,
  uso_cfdi TEXT,
  emisor_nombre TEXT,
  receptor_nombre TEXT,
  emisor_regimen TEXT,
  receptor_regimen TEXT,
  sat_validated BOOLEAN DEFAULT false,
  es_cancelable TEXT,
  estatus_cancelacion TEXT,
  xml_storage_path TEXT,
  sat_last_check TIMESTAMPTZ,
  descuento NUMERIC(15,2) DEFAULT 0,
  lugar_expedicion TEXT,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_invoices_uuid ON invoices(uuid) WHERE uuid IS NOT NULL;
CREATE UNIQUE INDEX idx_invoices_odoo ON invoices(company_id, odoo_id) WHERE odoo_id IS NOT NULL;
CREATE INDEX idx_invoices_type_status ON invoices(company_id, type, sat_status);
CREATE INDEX idx_invoices_vendor ON invoices(vendor_id);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_due ON invoices(due_date) WHERE amount_residual > 0;
CREATE INDEX idx_invoices_odoo_move ON invoices(odoo_move_id) WHERE odoo_move_id IS NOT NULL;

CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 8. PAYMENTS
-- ============================================================

CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  status TEXT DEFAULT 'draft',
  amount NUMERIC(15,2) NOT NULL,
  currency TEXT DEFAULT 'MXN',
  partner_name TEXT,
  partner_rfc TEXT,
  reference_id TEXT,
  clabe_origin TEXT,
  clabe_destination TEXT,
  comment TEXT,
  scheduled_date DATE,
  vendor_id INTEGER REFERENCES vendors(id),
  invoice_id INTEGER REFERENCES invoices(id),
  beneficiary_name VARCHAR(200),
  beneficiary_clabe TEXT,
  clabe VARCHAR(18),
  concept VARCHAR(40),
  reference VARCHAR(7),
  confirmed_at TIMESTAMPTZ,
  fintoc_transfer_id TEXT,
  fintoc_payment_intent_id TEXT,
  fintoc_error TEXT,
  odoo_id INTEGER,
  odoo_payment_id VARCHAR(50),
  odoo_synced_at TIMESTAMPTZ,
  odoo_state TEXT,
  created_by UUID,
  executed_at TIMESTAMPTZ,
  sat_status TEXT DEFAULT 'unknown',
  payment_state TEXT DEFAULT 'pending',
  reconciled_invoice_ids JSONB DEFAULT '[]',
  source TEXT DEFAULT 'manual',
  complemento_emitido BOOLEAN DEFAULT false,
  complemento_uuid TEXT,
  jws_signed BOOLEAN DEFAULT false,
  bank_movement_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_payments_odoo ON payments(company_id, odoo_id) WHERE odoo_id IS NOT NULL;
CREATE INDEX idx_payments_company_status ON payments(company_id, status);
CREATE INDEX idx_payments_vendor ON payments(vendor_id);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);
CREATE INDEX idx_payments_created ON payments(created_at DESC);
CREATE INDEX idx_payments_fintoc ON payments(fintoc_transfer_id) WHERE fintoc_transfer_id IS NOT NULL;
CREATE INDEX idx_payments_fintoc_pi ON payments(fintoc_payment_intent_id) WHERE fintoc_payment_intent_id IS NOT NULL;
CREATE INDEX idx_payments_odoo_pid ON payments(odoo_payment_id) WHERE odoo_payment_id IS NOT NULL;

CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 9. INVOICE_PAYMENTS
-- ============================================================

CREATE TABLE invoice_payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  amount DECIMAL(15,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_ip_unique ON invoice_payments(invoice_id, payment_id);

-- ============================================================
-- 10. CFDI_COMPLEMENTS
-- ============================================================

CREATE TABLE cfdi_complements (
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

-- ============================================================
-- 11. EXPENSES
-- ============================================================

CREATE TABLE expenses (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_name TEXT,
  employee_email TEXT,
  category TEXT,
  description TEXT,
  amount NUMERIC(15,2) NOT NULL,
  currency TEXT DEFAULT 'MXN',
  status TEXT DEFAULT 'submitted',
  xml_url TEXT,
  rejected_reason TEXT,
  approved_by UUID,
  created_by UUID,
  cfdi_uuid TEXT,
  sat_validated BOOLEAN DEFAULT false,
  product_category TEXT,
  payment_mode TEXT,
  sheet_id INTEGER,
  expense_reference TEXT,
  odoo_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_expenses_odoo ON expenses(company_id, odoo_id) WHERE odoo_id IS NOT NULL;

CREATE TRIGGER expenses_updated_at
  BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 12. APPROVAL_RULES
-- ============================================================

CREATE TABLE approval_rules (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  min_amount NUMERIC(15,2) DEFAULT 0,
  max_amount NUMERIC(15,2),
  amount_min NUMERIC(15,2),
  amount_max NUMERIC(15,2),
  required_approvers INTEGER DEFAULT 1,
  approver_emails TEXT[] DEFAULT '{}',
  approvers TEXT[],
  auto_approve_below NUMERIC(15,2),
  auto_approve BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 13. APPROVAL_REQUESTS
-- ============================================================

CREATE TABLE approval_requests (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payment_id INTEGER REFERENCES payments(id),
  rule_id INTEGER REFERENCES approval_rules(id),
  status TEXT DEFAULT 'pending',
  level INTEGER DEFAULT 1,
  approver_email TEXT,
  amount NUMERIC(15,2),
  partner_name TEXT,
  comment TEXT,
  entity_type TEXT DEFAULT 'payment',
  entity_id TEXT,
  requested_by UUID,
  resolved_by UUID,
  rejection_reason TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 14. BUDGETS
-- ============================================================

CREATE TABLE budgets (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category VARCHAR(100),
  period_start DATE,
  period_end DATE,
  amount_budgeted NUMERIC(15,2) DEFAULT 0,
  amount_spent NUMERIC(15,2) DEFAULT 0,
  amount_committed NUMERIC(15,2) DEFAULT 0,
  amount NUMERIC(15,2),
  alert_threshold_pct INTEGER DEFAULT 80,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 15. NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID,
  notification_type TEXT,
  event_type TEXT,
  entity_type TEXT,
  entity_id TEXT,
  title TEXT,
  message TEXT,
  channel TEXT DEFAULT 'in-app',
  is_read BOOLEAN DEFAULT false,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_notif_user_unread ON notifications(user_id, company_id) WHERE read = false;

-- Enable Realtime
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================================
-- 16. RECONCILIATIONS
-- ============================================================

CREATE TABLE reconciliations (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT,
  status TEXT DEFAULT 'pending',
  total_transactions INTEGER DEFAULT 0,
  matched INTEGER DEFAULT 0,
  unmatched INTEGER DEFAULT 0,
  amount_matched NUMERIC(15,2) DEFAULT 0,
  partial INTEGER DEFAULT 0,
  total_discrepancy NUMERIC(15,2) DEFAULT 0,
  period_days INTEGER DEFAULT 7,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 17. RECONCILIATION_ENTRIES
-- ============================================================

CREATE TABLE reconciliation_entries (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  reconciliation_id INTEGER REFERENCES reconciliations(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('fintoc-odoo', 'sat')),
  payment_ref TEXT,
  amount_erp NUMERIC(15,2) DEFAULT 0,
  amount_bank NUMERIC(15,2) DEFAULT 0,
  difference NUMERIC(15,2) DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('matched', 'unmatched', 'partial', 'manual')),
  cfdi_uuid TEXT,
  sat_status TEXT,
  notes TEXT,
  matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_recon_entries_company ON reconciliation_entries(company_id);
CREATE INDEX idx_recon_entries_recon_id ON reconciliation_entries(reconciliation_id);

-- ============================================================
-- 18. CFDI_DOCUMENTS
-- ============================================================

CREATE TABLE cfdi_documents (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  uuid TEXT UNIQUE,
  tipo_comprobante TEXT,
  rfc_emisor TEXT,
  nombre_emisor TEXT,
  rfc_receptor TEXT,
  nombre_receptor TEXT,
  total NUMERIC(15,2) DEFAULT 0,
  subtotal NUMERIC(15,2) DEFAULT 0,
  sat_status TEXT DEFAULT 'Vigente',
  fecha_emision TIMESTAMPTZ DEFAULT now(),
  fecha_timbrado TIMESTAMPTZ,
  xml_content TEXT,
  moneda TEXT DEFAULT 'MXN',
  tipo_cambio NUMERIC(15,6) DEFAULT 1,
  forma_pago TEXT,
  metodo_pago TEXT,
  uso_cfdi TEXT,
  lugar_expedicion TEXT,
  descuento NUMERIC(15,2) DEFAULT 0,
  emisor_regimen TEXT,
  receptor_regimen TEXT,
  receptor_domicilio_fiscal TEXT,
  exportacion TEXT,
  sello_sat TEXT,
  sello_cfd TEXT,
  no_certificado_sat TEXT,
  no_certificado_emisor TEXT,
  is_cancelable TEXT,
  cancellation_status TEXT,
  efos_status TEXT DEFAULT 'unknown',
  sat_last_check TIMESTAMPTZ,
  conceptos JSONB DEFAULT '[]',
  impuestos_trasladados NUMERIC(15,2) DEFAULT 0,
  impuestos_retenidos NUMERIC(15,2) DEFAULT 0,
  complemento_pago JSONB,
  complemento_nomina JSONB,
  xml_storage_path TEXT,
  invoice_id INTEGER REFERENCES invoices(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cfdi_documents_invoice ON cfdi_documents(invoice_id);
CREATE INDEX idx_cfdi_documents_tipo ON cfdi_documents(tipo_comprobante);
CREATE INDEX idx_cfdi_documents_emisor ON cfdi_documents(rfc_emisor);
CREATE INDEX idx_cfdi_documents_receptor ON cfdi_documents(rfc_receptor);
CREATE INDEX idx_cfdi_documents_status ON cfdi_documents(sat_status);
CREATE INDEX idx_cfdi_documents_efos ON cfdi_documents(efos_status);

CREATE TRIGGER cfdi_documents_updated_at
  BEFORE UPDATE ON cfdi_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 19. BANK_ACCOUNTS
-- ============================================================

CREATE TABLE bank_accounts (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
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
-- 20. BANK_MOVEMENTS
-- ============================================================

CREATE TABLE bank_movements (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fintoc_id TEXT,
  fintoc_movement_id VARCHAR(100),
  account_id TEXT,
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'MXN',
  description TEXT,
  post_date TIMESTAMPTZ,
  date DATE,
  type TEXT CHECK (type IN ('credit','debit')),
  reference_id TEXT,
  sender_account TEXT,
  counterpart_name TEXT,
  counterpart_account TEXT,
  fintoc_account_number_id TEXT,
  balance_after DECIMAL(15,2),
  reconciled BOOLEAN DEFAULT false,
  reconciled_payment_id INTEGER REFERENCES payments(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_bm_fintoc ON bank_movements(fintoc_id) WHERE fintoc_id IS NOT NULL;
CREATE UNIQUE INDEX idx_bm_fintoc_movement ON bank_movements(fintoc_movement_id) WHERE fintoc_movement_id IS NOT NULL;
CREATE INDEX idx_bm_date ON bank_movements(company_id, date DESC);

-- Add FK for payments.bank_movement_id now that bank_movements exists
ALTER TABLE payments ADD CONSTRAINT payments_bank_movement_fk
  FOREIGN KEY (bank_movement_id) REFERENCES bank_movements(id);

-- ============================================================
-- 21. SYNC_LOGS (audit trail for sync operations)
-- ============================================================

CREATE TABLE sync_logs (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('odoo', 'fintoc', 'sat')),
  sync_type TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'error')),
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  details JSONB DEFAULT '{}',
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sync_logs_company ON sync_logs(company_id);
CREATE INDEX idx_sync_logs_provider ON sync_logs(company_id, provider);
CREATE INDEX idx_sync_logs_started ON sync_logs(started_at DESC);

-- ============================================================
-- 22. SYNC_HISTORY (used by sync-engine lock mechanism)
-- ============================================================

CREATE TABLE sync_history (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  records_synced INTEGER,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- 23. SYNTAGE_EXTRACTIONS
-- ============================================================

CREATE TABLE syntage_extractions (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  syntage_extraction_id VARCHAR(100) NOT NULL,
  extractor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  records_found INTEGER,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- 24. AUDIT_LOG
-- ============================================================

CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  description TEXT,
  changes JSONB,
  metadata JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_log_company ON audit_log(company_id);
CREATE INDEX idx_audit_log_entity ON audit_log(company_id, entity_type, entity_id);
CREATE INDEX idx_audit_log_action ON audit_log(company_id, action);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX idx_audit_log_user ON audit_log(company_id, user_id);

-- ============================================================
-- 25. WEBHOOK_LOGS
-- ============================================================

CREATE TABLE webhook_logs (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id),
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wh_unprocessed ON webhook_logs(provider, processed) WHERE processed = false;

-- ============================================================
-- 26. WEBHOOK_EVENTS (Fintoc webhooks)
-- ============================================================

CREATE TABLE webhook_events (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_id TEXT,
  payload JSONB,
  processed BOOLEAN DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_webhook_events_company ON webhook_events(company_id);
CREATE INDEX idx_webhook_events_type ON webhook_events(event_type);
CREATE UNIQUE INDEX idx_webhook_events_eid ON webhook_events(event_id) WHERE event_id IS NOT NULL;

-- ============================================================
-- 27. ODOO_BANK_STATEMENTS
-- ============================================================

CREATE TABLE odoo_bank_statements (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  odoo_statement_line_id INTEGER,
  bank_movement_id INTEGER REFERENCES bank_movements(id),
  payment_id INTEGER REFERENCES payments(id),
  journal_id INTEGER,
  partner_id INTEGER,
  date DATE NOT NULL,
  payment_ref TEXT,
  amount DECIMAL(15,2) NOT NULL,
  currency TEXT DEFAULT 'MXN',
  status TEXT DEFAULT 'pending',
  odoo_match_status TEXT,
  error_message TEXT,
  pushed_at TIMESTAMPTZ,
  matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_odoo_bs_company ON odoo_bank_statements(company_id);
CREATE INDEX idx_odoo_bs_movement ON odoo_bank_statements(bank_movement_id);
CREATE INDEX idx_odoo_bs_status ON odoo_bank_statements(company_id, status);

-- ============================================================
-- 28. ODOO_PURCHASE_ORDERS
-- ============================================================

CREATE TABLE odoo_purchase_orders (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  odoo_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  partner_id INTEGER,
  partner_name TEXT,
  partner_rfc TEXT,
  vendor_id INTEGER REFERENCES vendors(id),
  state TEXT,
  amount_total DECIMAL(15,2) DEFAULT 0,
  amount_tax DECIMAL(15,2) DEFAULT 0,
  currency TEXT DEFAULT 'MXN',
  date_order TIMESTAMPTZ,
  date_planned TIMESTAMPTZ,
  invoice_status TEXT,
  invoice_count INTEGER DEFAULT 0,
  receipt_status TEXT,
  notes TEXT,
  source TEXT DEFAULT 'odoo',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_odoo_po_company ON odoo_purchase_orders(company_id, odoo_id);
CREATE INDEX idx_odoo_po_vendor ON odoo_purchase_orders(vendor_id);
CREATE INDEX idx_odoo_po_state ON odoo_purchase_orders(company_id, state);

-- ============================================================
-- 29. ODOO_ID_CACHE
-- ============================================================

CREATE TABLE odoo_id_cache (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  cache_key TEXT NOT NULL,
  odoo_id INTEGER NOT NULL,
  display_name TEXT,
  extra_data JSONB,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, cache_key)
);

CREATE INDEX idx_odoo_cache_lookup ON odoo_id_cache(company_id, cache_key);

-- ============================================================
-- 30. SAT_DOWNLOAD_REQUESTS
-- ============================================================

CREATE TABLE sat_download_requests (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  request_id TEXT,
  request_type TEXT NOT NULL CHECK (request_type IN ('emitidos', 'recibidos')),
  solicitud_type TEXT NOT NULL DEFAULT 'CFDI' CHECK (solicitud_type IN ('CFDI', 'Metadata')),
  fecha_inicio TIMESTAMPTZ NOT NULL,
  fecha_fin TIMESTAMPTZ NOT NULL,
  rfc_emisor TEXT,
  rfc_receptor TEXT,
  tipo_comprobante TEXT,
  estado_comprobante TEXT,
  complemento TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'processing', 'ready', 'downloaded', 'error', 'rejected')),
  num_cfdis INTEGER DEFAULT 0,
  num_packages INTEGER DEFAULT 0,
  packages_downloaded INTEGER DEFAULT 0,
  error_message TEXT,
  sat_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_sat_downloads_company ON sat_download_requests(company_id);
CREATE INDEX idx_sat_downloads_status ON sat_download_requests(status);

-- ============================================================
-- 31. SAT_CANCELLATION_REQUESTS
-- ============================================================

CREATE TABLE sat_cancellation_requests (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cfdi_uuid TEXT NOT NULL,
  invoice_id INTEGER REFERENCES invoices(id),
  motivo TEXT NOT NULL CHECK (motivo IN ('01', '02', '03', '04')),
  uuid_sustitucion TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'accepted', 'rejected', 'expired', 'error')),
  requires_acceptance BOOLEAN DEFAULT false,
  acceptance_deadline TIMESTAMPTZ,
  error_message TEXT,
  requested_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_sat_cancellations_company ON sat_cancellation_requests(company_id);
CREATE INDEX idx_sat_cancellations_uuid ON sat_cancellation_requests(cfdi_uuid);

-- ============================================================
-- 32. RFC_VALIDATIONS
-- ============================================================

CREATE TABLE rfc_validations (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rfc TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('vendor', 'customer', 'emisor', 'receptor')),
  entity_id INTEGER,
  is_valid BOOLEAN,
  nombre_razon_social TEXT,
  rfc_status TEXT,
  validated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_rfc_validations_rfc ON rfc_validations(rfc);
CREATE INDEX idx_rfc_validations_company ON rfc_validations(company_id);

-- ============================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfdi_complements ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfdi_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE syntage_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE odoo_bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE odoo_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE odoo_id_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE sat_download_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sat_cancellation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfc_validations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES (all use ::int for company_id comparison)
-- ============================================================

-- Company-scoped policies (JWT active_company_id claim)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'integrations', 'vendors', 'customers', 'invoices', 'payments',
    'cfdi_complements', 'expenses', 'approval_rules', 'approval_requests',
    'budgets', 'reconciliations', 'reconciliation_entries', 'cfdi_documents',
    'bank_accounts', 'bank_movements', 'sync_logs', 'sync_history',
    'syntage_extractions', 'webhook_logs', 'webhook_events',
    'odoo_bank_statements', 'odoo_purchase_orders', 'odoo_id_cache',
    'sat_download_requests', 'sat_cancellation_requests', 'rfc_validations'
  ]) LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (company_id = (auth.jwt() ->> ''active_company_id'')::int)',
      tbl || '_company_isolation', tbl
    );
  END LOOP;
END $$;

-- Companies: members can see their own companies
CREATE POLICY companies_member_access ON companies FOR ALL
  USING (id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid()));

-- Allow inserts during registration
CREATE POLICY companies_insert ON companies FOR INSERT WITH CHECK (true);

-- Users: can see own profile
CREATE POLICY users_own ON users FOR ALL
  USING (auth_uid = auth.uid());
CREATE POLICY users_insert ON users FOR INSERT WITH CHECK (true);

-- User_companies: own access
CREATE POLICY user_companies_own_access ON user_companies FOR ALL
  USING (user_id = auth.uid());

-- Notifications: user-scoped + company-scoped
DROP POLICY IF EXISTS notifications_company_isolation ON notifications;
CREATE POLICY notifications_own_access ON notifications FOR ALL
  USING (user_id = auth.uid() AND company_id = (auth.jwt() ->> 'active_company_id')::int);

-- Audit log: read-only for users
DROP POLICY IF EXISTS audit_log_company_isolation ON audit_log;
CREATE POLICY audit_log_read_only ON audit_log FOR SELECT
  USING (company_id = (auth.jwt() ->> 'active_company_id')::int);

-- Invoice payments: inherits from invoices
DROP POLICY IF EXISTS invoice_payments_company_isolation ON invoice_payments;
CREATE POLICY invoice_payments_access ON invoice_payments FOR ALL
  USING (invoice_id IN (SELECT id FROM invoices WHERE company_id = (auth.jwt() ->> 'active_company_id')::int));

-- ============================================================
-- CUSTOM ACCESS TOKEN HOOK
-- Sets active_company_id claim in JWT from user_companies
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

-- ============================================================
-- DATA FIXES (from migration 015)
-- ============================================================

-- Fix integrations that have config saved but is_connected was never set
UPDATE integrations
SET is_connected = true, status = 'valid'
WHERE is_connected = false
  AND config IS NOT NULL
  AND config::text != 'null'
  AND (status = 'pending' OR status IS NULL OR status = 'valid');

-- Set 'disconnected' for explicitly disconnected integrations
UPDATE integrations
SET status = 'disconnected'
WHERE is_connected = false
  AND config IS NULL
  AND (status = 'pending' OR status IS NULL);

-- Fix connected integrations stuck at 'pending'
UPDATE integrations
SET status = 'valid'
WHERE is_connected = true
  AND (status = 'pending' OR status IS NULL);
