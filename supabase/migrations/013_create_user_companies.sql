-- ============================================================
-- Migration 013: Create user_companies table (multi-tenant)
-- This table was referenced by migration 012 but never created.
-- It replaces the old single-company users.company_id approach.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_companies (
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

-- Only one active company per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_uc_active ON user_companies(user_id) WHERE is_active = true;

-- Fast lookup by company
CREATE INDEX IF NOT EXISTS idx_uc_company ON user_companies(company_id);

-- RLS
ALTER TABLE user_companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_companies_own_access ON user_companies;
CREATE POLICY user_companies_own_access ON user_companies FOR ALL
  USING (user_id = auth.uid());

-- Ensure onboarding_completed column exists on companies
ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
