-- ══════════════════════════════════════════════════════════
-- Migration 011: Audit log table
-- Run this in the Supabase SQL Editor AFTER migration 010
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT,
  action TEXT NOT NULL,            -- 'create', 'update', 'delete', 'execute', 'approve', 'reject', 'login', 'export'
  entity_type TEXT NOT NULL,       -- 'payment', 'invoice', 'vendor', 'customer', 'expense', 'budget', 'approval', 'config', 'user'
  entity_id TEXT,                  -- ID of the affected entity
  description TEXT,                -- Human-readable description
  metadata JSONB DEFAULT '{}',     -- Additional context (old/new values, IP, etc.)
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_tenant ON audit_log;
CREATE POLICY audit_log_tenant ON audit_log
  FOR ALL USING (company_id = auth_company_id());

DROP POLICY IF EXISTS audit_log_insert ON audit_log;
CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_log_company ON audit_log(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(company_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(company_id, action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(company_id, user_id);
