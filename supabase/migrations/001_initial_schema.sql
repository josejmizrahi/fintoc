-- ══════════════════════════════════════════════════════════
-- Migration 001: Initial Schema for Payana
-- Run this in the Supabase SQL Editor
-- ══════════════════════════════════════════════════════════

-- Companies
CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  rfc TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users (linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  auth_uid UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT 'SUPABASE_AUTH',
  name TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  company_id INTEGER REFERENCES companies(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id),
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id),
  type TEXT NOT NULL CHECK (type IN ('receivable','payable')),
  partner_name TEXT,
  partner_rfc TEXT,
  amount_total NUMERIC(15,2) DEFAULT 0,
  amount_residual NUMERIC(15,2) DEFAULT 0,
  date_invoice DATE,
  date_due DATE,
  status TEXT DEFAULT 'open',
  cfdi_uuid TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vendors
CREATE TABLE IF NOT EXISTS vendors (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id),
  name TEXT NOT NULL,
  rfc TEXT,
  email TEXT,
  clabe TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id),
  name TEXT NOT NULL,
  rfc TEXT,
  email TEXT,
  clabe TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id),
  employee_name TEXT,
  employee_email TEXT,
  category TEXT,
  description TEXT,
  amount NUMERIC(15,2) NOT NULL,
  currency TEXT DEFAULT 'MXN',
  status TEXT DEFAULT 'submitted',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Approval Rules
CREATE TABLE IF NOT EXISTS approval_rules (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id),
  name TEXT NOT NULL,
  min_amount NUMERIC(15,2) DEFAULT 0,
  max_amount NUMERIC(15,2),
  required_approvers INTEGER DEFAULT 1,
  approver_emails TEXT[] DEFAULT '{}',
  auto_approve_below NUMERIC(15,2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Approval Requests
CREATE TABLE IF NOT EXISTS approval_requests (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id),
  payment_id INTEGER REFERENCES payments(id),
  rule_id INTEGER REFERENCES approval_rules(id),
  status TEXT DEFAULT 'pending',
  level INTEGER DEFAULT 1,
  approver_email TEXT,
  amount NUMERIC(15,2),
  partner_name TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Budgets
CREATE TABLE IF NOT EXISTS budgets (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id),
  name TEXT NOT NULL,
  category TEXT,
  period_start DATE,
  period_end DATE,
  amount_budgeted NUMERIC(15,2) DEFAULT 0,
  amount_spent NUMERIC(15,2) DEFAULT 0,
  amount_committed NUMERIC(15,2) DEFAULT 0,
  alert_threshold_pct INTEGER DEFAULT 80,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id),
  notification_type TEXT,
  title TEXT,
  message TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reconciliations
CREATE TABLE IF NOT EXISTS reconciliations (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id),
  type TEXT,
  status TEXT DEFAULT 'pending',
  total_transactions INTEGER DEFAULT 0,
  matched INTEGER DEFAULT 0,
  unmatched INTEGER DEFAULT 0,
  amount_matched NUMERIC(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CFDI Documents
CREATE TABLE IF NOT EXISTS cfdi_documents (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id),
  uuid TEXT UNIQUE,
  tipo_comprobante TEXT,
  rfc_emisor TEXT,
  nombre_emisor TEXT,
  rfc_receptor TEXT,
  total NUMERIC(15,2) DEFAULT 0,
  sat_status TEXT DEFAULT 'Vigente',
  fecha_emision TIMESTAMPTZ DEFAULT NOW()
);
