-- ══════════════════════════════════════════════════════════
-- Migration 003: Integrations table for storing service credentials
-- Run this in the Supabase SQL Editor AFTER migration 002
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS integrations (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('odoo', 'fintoc', 'sat')),
  is_connected BOOLEAN DEFAULT false,
  config JSONB DEFAULT '{}',
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, provider)
);

-- Track onboarding completion
ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;

-- RLS
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integrations_tenant ON integrations;
CREATE POLICY integrations_tenant ON integrations
  FOR ALL USING (company_id = auth_company_id());

DROP POLICY IF EXISTS integrations_insert ON integrations;
CREATE POLICY integrations_insert ON integrations
  FOR INSERT WITH CHECK (true);
