import { sql, db as pool } from "@vercel/postgres";

// ── Schema ──

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  rfc TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  company_id INTEGER REFERENCES companies(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id),
  notification_type TEXT,
  title TEXT,
  message TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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
`;

// ── Init & Seed ──

export async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA_SQL);
    return { success: true };
  } finally {
    client.release();
  }
}

export async function seedDB(companyId: number) {
  const client = await pool.connect();
  try {
    // Check if already seeded
    const { rows } = await client.query(
      "SELECT COUNT(*) as c FROM payments WHERE company_id = $1",
      [companyId]
    );
    if (parseInt(rows[0].c) > 0) return { seeded: false, message: "Already seeded" };

    const now = new Date().toISOString();

    // Payments
    await client.query(`
      INSERT INTO payments (company_id, direction, status, amount, currency, partner_name, partner_rfc, reference_id) VALUES
      ($1, 'outbound', 'confirmed', 45000, 'MXN', 'Materiales MX SA de CV', 'MMX010101AAA', 'PAY-001'),
      ($1, 'outbound', 'pending_approval', 125000, 'MXN', 'Logística Express SA', 'LEX020202BBB', 'PAY-002'),
      ($1, 'inbound', 'confirmed', 89000, 'MXN', 'TechCorp SA de CV', 'TCS030303CCC', 'PAY-003'),
      ($1, 'outbound', 'draft', 67000, 'MXN', 'Servicios Cloud MX', 'SCM040404DDD', 'PAY-004'),
      ($1, 'outbound', 'scheduled', 230000, 'MXN', 'Distribuidora Nacional SA', 'DNA050505EEE', 'PAY-005')
    `, [companyId]);

    // Invoices receivable
    await client.query(`
      INSERT INTO invoices (company_id, type, partner_name, partner_rfc, amount_total, amount_residual, date_invoice, date_due, status, cfdi_uuid) VALUES
      ($1, 'receivable', 'Acme SA de CV', 'ACM010101AAA', 125000, 125000, CURRENT_DATE, CURRENT_DATE + 15, 'open', 'ABC12345-0001'),
      ($1, 'receivable', 'TechCorp SA', 'TCS020202BBB', 89000, 0, CURRENT_DATE, CURRENT_DATE + 20, 'paid', 'DEF67890-0002'),
      ($1, 'receivable', 'Global Trade MX', 'GTM030303CCC', 340000, 340000, CURRENT_DATE - 35, CURRENT_DATE - 5, 'overdue', 'GHI11111-0003')
    `, [companyId]);

    // Invoices payable
    await client.query(`
      INSERT INTO invoices (company_id, type, partner_name, partner_rfc, amount_total, amount_residual, date_invoice, date_due, status, cfdi_uuid) VALUES
      ($1, 'payable', 'Materiales MX SA', 'MMX010101AAA', 45000, 45000, CURRENT_DATE, CURRENT_DATE + 10, 'open', 'JKL22222-0004'),
      ($1, 'payable', 'Logística Express', 'LEX020202BBB', 125000, 125000, CURRENT_DATE, CURRENT_DATE + 18, 'open', 'MNO33333-0005')
    `, [companyId]);

    // Vendors
    await client.query(`
      INSERT INTO vendors (company_id, name, rfc, email, clabe) VALUES
      ($1, 'Materiales MX SA de CV', 'MMX010101AAA', 'pagos@materiales.mx', '012180015678901234'),
      ($1, 'Logística Express SA', 'LEX020202BBB', 'finanzas@logistica.mx', '014320012345678901'),
      ($1, 'Servicios Cloud MX', 'SCM040404DDD', 'billing@cloud.mx', '021180098765432109'),
      ($1, 'Distribuidora Nacional SA', 'DNA050505EEE', 'cxp@distribuidora.mx', '072180045678901234')
    `, [companyId]);

    // Customers
    await client.query(`
      INSERT INTO customers (company_id, name, rfc, email, clabe) VALUES
      ($1, 'Acme SA de CV', 'ACM010101AAA', 'pagos@acme.mx', '646180157800000001'),
      ($1, 'TechCorp SA de CV', 'TCS020202BBB', 'finanzas@techcorp.mx', '646180157800000002'),
      ($1, 'Global Trade MX SA', 'GTM030303CCC', 'admin@globaltrade.mx', '646180157800000003')
    `, [companyId]);

    // Expenses
    await client.query(`
      INSERT INTO expenses (company_id, employee_name, employee_email, category, description, amount, currency, status) VALUES
      ($1, 'María García', 'maria@empresa.com', 'viaje', 'Viaje a Monterrey', 8500, 'MXN', 'submitted'),
      ($1, 'Carlos López', 'carlos@empresa.com', 'oficina', 'Material de oficina', 3200, 'MXN', 'approved'),
      ($1, 'Ana Rodríguez', 'ana@empresa.com', 'comida', 'Comida con cliente', 1800, 'MXN', 'paid')
    `, [companyId]);

    // Approval rules
    await client.query(`
      INSERT INTO approval_rules (company_id, name, min_amount, max_amount, required_approvers, approver_emails, auto_approve_below) VALUES
      ($1, 'Pagos mayores a $50,000', 50000, NULL, 1, ARRAY['director@empresa.com'], 50000),
      ($1, 'Pagos mayores a $500,000', 500000, NULL, 2, ARRAY['director@empresa.com','cfo@empresa.com'], NULL)
    `, [companyId]);

    // Approval requests
    const payRes = await client.query(
      "SELECT id FROM payments WHERE company_id = $1 AND status = 'pending_approval' LIMIT 1",
      [companyId]
    );
    if (payRes.rows.length > 0) {
      const ruleRes = await client.query(
        "SELECT id FROM approval_rules WHERE company_id = $1 LIMIT 1",
        [companyId]
      );
      if (ruleRes.rows.length > 0) {
        await client.query(`
          INSERT INTO approval_requests (company_id, payment_id, rule_id, status, level, approver_email, amount, partner_name) VALUES
          ($1, $2, $3, 'pending', 1, 'director@empresa.com', 125000, 'Logística Express')
        `, [companyId, payRes.rows[0].id, ruleRes.rows[0].id]);
      }
    }

    // Budgets
    await client.query(`
      INSERT INTO budgets (company_id, name, category, period_start, period_end, amount_budgeted, amount_spent, amount_committed, alert_threshold_pct) VALUES
      ($1, 'Marketing Q1', 'marketing', '2026-01-01', '2026-03-31', 500000, 320000, 80000, 80),
      ($1, 'Operaciones Q1', 'operaciones', '2026-01-01', '2026-03-31', 1200000, 890000, 150000, 90),
      ($1, 'IT Q1', 'tecnología', '2026-01-01', '2026-03-31', 300000, 210000, 40000, 85)
    `, [companyId]);

    // Notifications
    await client.query(`
      INSERT INTO notifications (company_id, notification_type, title, message, is_read) VALUES
      ($1, 'payment_received', 'Pago recibido', 'Se recibió pago de $125,000 de Acme SA', false),
      ($1, 'approval_required', 'Aprobación pendiente', 'Pago de $125,000 a Logística Express requiere aprobación', false),
      ($1, 'invoice_overdue', 'Factura vencida', 'Factura de Global Trade MX por $340,000 está vencida', true)
    `, [companyId]);

    // Reconciliations
    await client.query(`
      INSERT INTO reconciliations (company_id, type, status, total_transactions, matched, unmatched, amount_matched) VALUES
      ($1, 'fintoc-odoo', 'matched', 45, 42, 3, 1850000),
      ($1, 'sat', 'matched', 30, 28, 2, 2100000)
    `, [companyId]);

    // CFDI documents
    await client.query(`
      INSERT INTO cfdi_documents (company_id, uuid, tipo_comprobante, rfc_emisor, nombre_emisor, rfc_receptor, total, sat_status) VALUES
      ($1, 'ABC12345-XXXX-YYYY-ZZZZ-000000000001', 'I', 'ACM010101AAA', 'Acme SA', 'DCO230101AAA', 125000, 'Vigente'),
      ($1, 'DEF67890-XXXX-YYYY-ZZZZ-000000000002', 'I', 'TCS020202BBB', 'TechCorp', 'DCO230101AAA', 89000, 'Vigente')
    `, [companyId]);

    return { seeded: true };
  } finally {
    client.release();
  }
}

// ── Helpers ──

export function hasDB(): boolean {
  return !!(process.env.POSTGRES_URL || process.env.DATABASE_URL);
}

export async function query(text: string, params?: unknown[]) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}
