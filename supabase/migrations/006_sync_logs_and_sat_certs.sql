-- ══════════════════════════════════════════════════════════
-- Migration 006: sync_logs table, SAT certificates storage, missing columns
-- Run this in the Supabase SQL Editor AFTER migration 005
-- ══════════════════════════════════════════════════════════

-- ── Sync Logs (audit trail for all integration syncs) ──

CREATE TABLE IF NOT EXISTS sync_logs (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('odoo', 'fintoc', 'sat')),
  sync_type TEXT, -- 'full', 'incremental', 'revalidate'
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'error')),
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  details JSONB DEFAULT '{}',
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_logs_tenant ON sync_logs;
CREATE POLICY sync_logs_tenant ON sync_logs
  FOR ALL USING (company_id = auth_company_id());

DROP POLICY IF EXISTS sync_logs_insert ON sync_logs;
CREATE POLICY sync_logs_insert ON sync_logs
  FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_sync_logs_company ON sync_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_provider ON sync_logs(company_id, provider);
CREATE INDEX IF NOT EXISTS idx_sync_logs_started ON sync_logs(started_at DESC);

-- ── Missing columns on expenses ──

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS cfdi_uuid TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS sat_validated BOOLEAN DEFAULT false;

-- ── Missing column on notifications ──

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'in-app';

-- ── SAT certificate file metadata (stored as base64 in config JSONB) ──
-- We store certificate info in integrations.config but add columns to track cert details

ALTER TABLE integrations ADD COLUMN IF NOT EXISTS cert_serial TEXT;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS cert_expires_at TIMESTAMPTZ;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS cert_uploaded_at TIMESTAMPTZ;

-- ── Supabase Storage bucket for SAT certificates (run via dashboard if needed) ──
-- INSERT INTO storage.buckets (id, name, public) VALUES ('sat-certificates', 'sat-certificates', false)
-- ON CONFLICT DO NOTHING;
