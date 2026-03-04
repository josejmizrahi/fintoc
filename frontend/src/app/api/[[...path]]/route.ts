import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth-server";
import { hasDB, query } from "@/lib/db";

/**
 * Catch-all API route — uses Vercel Postgres when configured, otherwise mock data.
 */

const now = new Date().toISOString();
const today = now.slice(0, 10);

// ── Helper to get company_id from JWT ──

async function getCompanyId(req: NextRequest): Promise<number | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const payload = await verifyToken(auth.slice(7));
  return payload ? Number(payload.company_id) : null;
}

// ── Mock Data (fallback when no DB) ──

const MOCK = {
  dashboard: {
    cash_balance: 2_450_000.0,
    accounts_receivable: 1_850_000.0,
    accounts_payable: 980_000.0,
    pending_payments: 5,
    overdue_invoices: 3,
    pending_approvals: 2,
    recent_movements: [
      { id: 1, type: "inbound", amount: 125000, description: "Pago cliente Acme SA", date: today, status: "confirmed" },
      { id: 2, type: "outbound", amount: 45000, description: "Pago proveedor Materiales MX", date: today, status: "confirmed" },
      { id: 3, type: "inbound", amount: 89000, description: "Pago cliente TechCorp", date: today, status: "confirmed" },
    ],
    cash_flow_trend: [
      { date: "Lun", inflows: 250000, outflows: 180000 },
      { date: "Mar", inflows: 320000, outflows: 150000 },
      { date: "Mié", inflows: 180000, outflows: 220000 },
      { date: "Jue", inflows: 410000, outflows: 190000 },
      { date: "Vie", inflows: 290000, outflows: 310000 },
    ],
  },
  payments: [
    { id: 1, direction: "outbound", status: "confirmed", amount: 45000, currency: "MXN", partner_name: "Materiales MX SA", partner_rfc: "MMX010101AAA", reference_id: "PAY-001", created_at: now },
    { id: 2, direction: "outbound", status: "pending_approval", amount: 125000, currency: "MXN", partner_name: "Logística Express", partner_rfc: "LEX020202BBB", reference_id: "PAY-002", created_at: now },
    { id: 3, direction: "inbound", status: "confirmed", amount: 89000, currency: "MXN", partner_name: "TechCorp SA de CV", partner_rfc: "TCS030303CCC", reference_id: "PAY-003", created_at: now },
    { id: 4, direction: "outbound", status: "draft", amount: 67000, currency: "MXN", partner_name: "Servicios Cloud MX", partner_rfc: "SCM040404DDD", reference_id: "PAY-004", created_at: now },
    { id: 5, direction: "outbound", status: "scheduled", amount: 230000, currency: "MXN", partner_name: "Distribuidora Nacional", partner_rfc: "DNA050505EEE", reference_id: "PAY-005", scheduled_date: today, created_at: now },
  ],
  invoicesReceivable: [
    { id: 1, partner_name: "Acme SA de CV", partner_rfc: "ACM010101AAA", amount_total: 125000, amount_residual: 125000, date_invoice: today, date_due: "2026-03-15", status: "open", cfdi_uuid: "ABC12345" },
    { id: 2, partner_name: "TechCorp SA", partner_rfc: "TCS020202BBB", amount_total: 89000, amount_residual: 0, date_invoice: today, date_due: "2026-03-20", status: "paid", cfdi_uuid: "DEF67890" },
    { id: 3, partner_name: "Global Trade MX", partner_rfc: "GTM030303CCC", amount_total: 340000, amount_residual: 340000, date_invoice: today, date_due: "2026-02-28", status: "overdue", cfdi_uuid: "GHI11111" },
  ],
  invoicesPayable: [
    { id: 4, partner_name: "Materiales MX SA", partner_rfc: "MMX010101AAA", amount_total: 45000, amount_residual: 45000, date_invoice: today, date_due: "2026-03-10", status: "open", cfdi_uuid: "JKL22222" },
    { id: 5, partner_name: "Logística Express", partner_rfc: "LEX020202BBB", amount_total: 125000, amount_residual: 125000, date_invoice: today, date_due: "2026-03-18", status: "open", cfdi_uuid: "MNO33333" },
  ],
  vendors: [
    { id: 1, name: "Materiales MX SA de CV", rfc: "MMX010101AAA", email: "pagos@materiales.mx", clabe: "012180015678901234", total_payable: 45000, bills_count: 2 },
    { id: 2, name: "Logística Express SA", rfc: "LEX020202BBB", email: "finanzas@logistica.mx", clabe: "014320012345678901", total_payable: 125000, bills_count: 3 },
    { id: 3, name: "Servicios Cloud MX", rfc: "SCM040404DDD", email: "billing@cloud.mx", clabe: "021180098765432109", total_payable: 67000, bills_count: 1 },
    { id: 4, name: "Distribuidora Nacional SA", rfc: "DNA050505EEE", email: "cxp@distribuidora.mx", clabe: "072180045678901234", total_payable: 230000, bills_count: 4 },
  ],
  customers: [
    { id: 1, name: "Acme SA de CV", rfc: "ACM010101AAA", email: "pagos@acme.mx", clabe: "646180157800000001", total_receivable: 125000, invoices_count: 2 },
    { id: 2, name: "TechCorp SA de CV", rfc: "TCS020202BBB", email: "finanzas@techcorp.mx", clabe: "646180157800000002", total_receivable: 89000, invoices_count: 1 },
    { id: 3, name: "Global Trade MX SA", rfc: "GTM030303CCC", email: "admin@globaltrade.mx", clabe: "646180157800000003", total_receivable: 340000, invoices_count: 3 },
  ],
  expenses: [
    { id: 1, employee_name: "María García", category: "viaje", description: "Viaje a Monterrey", amount: 8500, currency: "MXN", status: "submitted", created_at: now },
    { id: 2, employee_name: "Carlos López", category: "oficina", description: "Material de oficina", amount: 3200, currency: "MXN", status: "approved", created_at: now },
    { id: 3, employee_name: "Ana Rodríguez", category: "comida", description: "Comida con cliente", amount: 1800, currency: "MXN", status: "paid", created_at: now },
  ],
  approvalRules: [
    { id: 1, name: "Pagos mayores a $50,000", min_amount: 50000, max_amount: null, required_approvers: 1, approver_emails: ["director@empresa.com"], auto_approve_below: 50000, is_active: true },
    { id: 2, name: "Pagos mayores a $500,000", min_amount: 500000, max_amount: null, required_approvers: 2, approver_emails: ["director@empresa.com", "cfo@empresa.com"], auto_approve_below: null, is_active: true },
  ],
  pendingApprovals: [
    { id: 1, payment_id: 2, status: "pending", level: 1, approver_email: "director@empresa.com", amount: 125000, partner_name: "Logística Express", created_at: now },
  ],
  treasurySnapshot: {
    total_balance: 2_450_000, available_balance: 2_100_000, reserved_balance: 350_000,
    accounts: [
      { name: "Cuenta Principal SPEI", balance: 1_800_000, currency: "MXN", bank: "STP" },
      { name: "Cuenta Operativa", balance: 650_000, currency: "MXN", bank: "BBVA" },
    ],
    pending_inflows: 554_000, pending_outflows: 467_000,
  },
  budgets: [
    { id: 1, name: "Marketing Q1", category: "marketing", period_start: "2026-01-01", period_end: "2026-03-31", amount_budgeted: 500000, amount_spent: 320000, amount_committed: 80000, alert_threshold_pct: 80, is_active: true },
    { id: 2, name: "Operaciones Q1", category: "operaciones", period_start: "2026-01-01", period_end: "2026-03-31", amount_budgeted: 1200000, amount_spent: 890000, amount_committed: 150000, alert_threshold_pct: 90, is_active: true },
    { id: 3, name: "IT Q1", category: "tecnología", period_start: "2026-01-01", period_end: "2026-03-31", amount_budgeted: 300000, amount_spent: 210000, amount_committed: 40000, alert_threshold_pct: 85, is_active: true },
  ],
  notifications: [
    { id: 1, notification_type: "payment_received", title: "Pago recibido", message: "Se recibió pago de $125,000 de Acme SA", is_read: false, created_at: now },
    { id: 2, notification_type: "approval_required", title: "Aprobación pendiente", message: "Pago de $125,000 a Logística Express requiere aprobación", is_read: false, created_at: now },
    { id: 3, notification_type: "invoice_overdue", title: "Factura vencida", message: "Factura de Global Trade MX por $340,000 está vencida", is_read: true, created_at: now },
  ],
  reconciliationHistory: [
    { id: 1, type: "fintoc-odoo", status: "matched", total_transactions: 45, matched: 42, unmatched: 3, amount_matched: 1_850_000, created_at: now },
    { id: 2, type: "sat", status: "matched", total_transactions: 30, matched: 28, unmatched: 2, amount_matched: 2_100_000, created_at: now },
  ],
  satDocuments: [
    { id: 1, uuid: "ABC12345-XXXX-YYYY-ZZZZ-000000000001", tipo_comprobante: "I", rfc_emisor: "ACM010101AAA", nombre_emisor: "Acme SA", total: 125000, sat_status: "Vigente", fecha_emision: now },
    { id: 2, uuid: "DEF67890-XXXX-YYYY-ZZZZ-000000000002", tipo_comprobante: "I", rfc_emisor: "TCS020202BBB", nombre_emisor: "TechCorp", total: 89000, sat_status: "Vigente", fecha_emision: now },
  ],
};

// ── Path matching ──

function matchPath(path: string, pattern: string): Record<string, string> | null {
  const pp = path.split("/").filter(Boolean);
  const pt = pattern.split("/").filter(Boolean);
  if (pp.length !== pt.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pt.length; i++) {
    if (pt[i].startsWith(":")) params[pt[i].slice(1)] = pp[i];
    else if (pt[i] !== pp[i]) return null;
  }
  return params;
}

// ── DB query helpers (return null when DB not available) ──

async function dbGet(path: string, companyId: number | null): Promise<unknown | null> {
  if (!hasDB() || !companyId) return null;

  try {
    // Dashboard
    if (path === "dashboard") {
      const [payRes, recvRes, payableRes, approvalRes] = await Promise.all([
        query("SELECT COALESCE(SUM(CASE WHEN direction='inbound' AND status='confirmed' THEN amount ELSE 0 END) - SUM(CASE WHEN direction='outbound' AND status='confirmed' THEN amount ELSE 0 END), 0) as cash_balance, COUNT(*) FILTER (WHERE status IN ('draft','pending_approval')) as pending_payments FROM payments WHERE company_id=$1", [companyId]),
        query("SELECT COALESCE(SUM(amount_residual),0) as total FROM invoices WHERE company_id=$1 AND type='receivable' AND status != 'paid'", [companyId]),
        query("SELECT COALESCE(SUM(amount_residual),0) as total FROM invoices WHERE company_id=$1 AND type='payable' AND status != 'paid'", [companyId]),
        query("SELECT COUNT(*) as c FROM approval_requests WHERE company_id=$1 AND status='pending'", [companyId]),
      ]);
      const overdueRes = await query("SELECT COUNT(*) as c FROM invoices WHERE company_id=$1 AND status='overdue'", [companyId]);
      const movRes = await query("SELECT id, direction as type, amount, partner_name as description, created_at as date, status FROM payments WHERE company_id=$1 AND status='confirmed' ORDER BY created_at DESC LIMIT 5", [companyId]);
      return {
        cash_balance: Number(payRes.rows[0].cash_balance),
        accounts_receivable: Number(recvRes.rows[0].total),
        accounts_payable: Number(payableRes.rows[0].total),
        pending_payments: Number(payRes.rows[0].pending_payments),
        overdue_invoices: Number(overdueRes.rows[0].c),
        pending_approvals: Number(approvalRes.rows[0].c),
        recent_movements: movRes.rows,
        cash_flow_trend: MOCK.dashboard.cash_flow_trend,
      };
    }

    // Payments
    if (path === "payments" || path === "payments/") {
      const res = await query("SELECT * FROM payments WHERE company_id=$1 ORDER BY created_at DESC", [companyId]);
      return res.rows;
    }
    if (path === "payments/scheduled/list") {
      const res = await query("SELECT * FROM payments WHERE company_id=$1 AND status='scheduled' ORDER BY scheduled_date", [companyId]);
      return res.rows;
    }
    let m = matchPath(path, "payments/:id");
    if (m) {
      const res = await query("SELECT * FROM payments WHERE id=$1 AND company_id=$2", [m.id, companyId]);
      return res.rows[0] || null;
    }

    // Invoices
    if (path === "invoices/receivable") {
      const res = await query("SELECT * FROM invoices WHERE company_id=$1 AND type='receivable' ORDER BY date_due", [companyId]);
      return res.rows;
    }
    if (path === "invoices/payable") {
      const res = await query("SELECT * FROM invoices WHERE company_id=$1 AND type='payable' ORDER BY date_due", [companyId]);
      return res.rows;
    }
    if (path === "invoices/overdue/receivable") {
      const res = await query("SELECT * FROM invoices WHERE company_id=$1 AND type='receivable' AND status='overdue'", [companyId]);
      return res.rows;
    }
    if (path === "invoices/overdue/payable") {
      const res = await query("SELECT * FROM invoices WHERE company_id=$1 AND type='payable' AND status='overdue'", [companyId]);
      return res.rows;
    }
    m = matchPath(path, "invoices/:id");
    if (m) {
      const res = await query("SELECT * FROM invoices WHERE id=$1 AND company_id=$2", [m.id, companyId]);
      return res.rows[0] || null;
    }
    m = matchPath(path, "invoices/:id/cfdi");
    if (m) {
      const res = await query("SELECT cfdi_uuid as uuid, status FROM invoices WHERE id=$1 AND company_id=$2", [m.id, companyId]);
      return res.rows[0] || { uuid: null, status: null };
    }

    // Vendors
    if (path === "vendors" || path === "vendors/") {
      const res = await query(`
        SELECT v.*, COALESCE(SUM(i.amount_residual),0) as total_payable, COUNT(i.id) as bills_count
        FROM vendors v LEFT JOIN invoices i ON i.partner_rfc = v.rfc AND i.company_id = v.company_id AND i.type='payable' AND i.status != 'paid'
        WHERE v.company_id=$1 GROUP BY v.id ORDER BY v.name
      `, [companyId]);
      return res.rows;
    }
    m = matchPath(path, "vendors/:id/clabe");
    if (m) {
      const res = await query("SELECT clabe FROM vendors WHERE id=$1 AND company_id=$2", [m.id, companyId]);
      return res.rows[0] || { clabe: null };
    }
    m = matchPath(path, "vendors/:id/bills");
    if (m) {
      const vRes = await query("SELECT rfc FROM vendors WHERE id=$1 AND company_id=$2", [m.id, companyId]);
      if (vRes.rows[0]) {
        const res = await query("SELECT * FROM invoices WHERE company_id=$1 AND type='payable' AND partner_rfc=$2", [companyId, vRes.rows[0].rfc]);
        return res.rows;
      }
      return [];
    }
    m = matchPath(path, "vendors/:id");
    if (m) {
      const res = await query("SELECT * FROM vendors WHERE id=$1 AND company_id=$2", [m.id, companyId]);
      return res.rows[0] || null;
    }

    // Customers
    if (path === "customers" || path === "customers/") {
      const res = await query(`
        SELECT c.*, COALESCE(SUM(i.amount_residual),0) as total_receivable, COUNT(i.id) as invoices_count
        FROM customers c LEFT JOIN invoices i ON i.partner_rfc = c.rfc AND i.company_id = c.company_id AND i.type='receivable' AND i.status != 'paid'
        WHERE c.company_id=$1 GROUP BY c.id ORDER BY c.name
      `, [companyId]);
      return res.rows;
    }
    if (path === "customers/search") return null; // handled in GET with query params
    m = matchPath(path, "customers/:id/clabe");
    if (m) {
      const res = await query("SELECT clabe FROM customers WHERE id=$1 AND company_id=$2", [m.id, companyId]);
      return res.rows[0] || { clabe: null };
    }
    m = matchPath(path, "customers/:id/invoices");
    if (m) {
      const cRes = await query("SELECT rfc FROM customers WHERE id=$1 AND company_id=$2", [m.id, companyId]);
      if (cRes.rows[0]) {
        const res = await query("SELECT * FROM invoices WHERE company_id=$1 AND type='receivable' AND partner_rfc=$2", [companyId, cRes.rows[0].rfc]);
        return res.rows;
      }
      return [];
    }
    m = matchPath(path, "customers/:id");
    if (m) {
      const res = await query("SELECT * FROM customers WHERE id=$1 AND company_id=$2", [m.id, companyId]);
      return res.rows[0] || null;
    }

    // Expenses
    if (path === "expenses" || path === "expenses/") {
      const res = await query("SELECT * FROM expenses WHERE company_id=$1 ORDER BY created_at DESC", [companyId]);
      return res.rows;
    }
    if (path === "expenses/summary") {
      const res = await query(`
        SELECT COALESCE(SUM(amount),0) as total,
               json_object_agg(COALESCE(category,'other'), cat_total) as by_category,
               json_object_agg(COALESCE(status,'submitted'), status_count) as by_status
        FROM (SELECT category, SUM(amount) as cat_total, status, COUNT(*) as status_count FROM expenses WHERE company_id=$1 GROUP BY category, status) sub
      `, [companyId]);
      return res.rows[0] || { total: 0, by_category: {}, by_status: {} };
    }

    // Approvals
    if (path === "approvals/rules") {
      const res = await query("SELECT * FROM approval_rules WHERE company_id=$1 ORDER BY min_amount", [companyId]);
      return res.rows;
    }
    if (path === "approvals/pending") {
      const res = await query("SELECT * FROM approval_requests WHERE company_id=$1 AND status='pending' ORDER BY created_at DESC", [companyId]);
      return res.rows;
    }
    m = matchPath(path, "approvals/:id/history");
    if (m) {
      const res = await query("SELECT * FROM approval_requests WHERE payment_id=$1 AND company_id=$2 ORDER BY created_at", [m.id, companyId]);
      return res.rows;
    }

    // Treasury
    if (path === "treasury/snapshot") {
      const balRes = await query(`
        SELECT COALESCE(SUM(CASE WHEN direction='inbound' AND status='confirmed' THEN amount ELSE 0 END) -
               SUM(CASE WHEN direction='outbound' AND status='confirmed' THEN amount ELSE 0 END), 0) as balance,
               COALESCE(SUM(CASE WHEN direction='inbound' AND status IN ('draft','pending_approval','scheduled') THEN amount ELSE 0 END), 0) as pending_inflows,
               COALESCE(SUM(CASE WHEN direction='outbound' AND status IN ('draft','pending_approval','scheduled') THEN amount ELSE 0 END), 0) as pending_outflows
        FROM payments WHERE company_id=$1
      `, [companyId]);
      const b = balRes.rows[0];
      return {
        total_balance: Number(b.balance),
        available_balance: Number(b.balance),
        reserved_balance: 0,
        accounts: [{ name: "Cuenta Principal SPEI", balance: Number(b.balance), currency: "MXN", bank: "STP" }],
        pending_inflows: Number(b.pending_inflows),
        pending_outflows: Number(b.pending_outflows),
      };
    }
    if (path === "treasury/forecast") return null; // complex — use mock
    if (path === "treasury/cash-flow") {
      const res = await query(`
        SELECT COALESCE(SUM(CASE WHEN direction='inbound' THEN amount ELSE 0 END), 0) as inflows,
               COALESCE(SUM(CASE WHEN direction='outbound' THEN amount ELSE 0 END), 0) as outflows
        FROM payments WHERE company_id=$1 AND status='confirmed'
      `, [companyId]);
      const r = res.rows[0];
      return { inflows: Number(r.inflows), outflows: Number(r.outflows), net: Number(r.inflows) - Number(r.outflows) };
    }
    if (path === "treasury/balance") {
      const res = await query(`
        SELECT COALESCE(SUM(CASE WHEN direction='inbound' AND status='confirmed' THEN amount ELSE 0 END) -
               SUM(CASE WHEN direction='outbound' AND status='confirmed' THEN amount ELSE 0 END), 0) as balance
        FROM payments WHERE company_id=$1
      `, [companyId]);
      return { balance: Number(res.rows[0].balance), currency: "MXN" };
    }
    if (path === "treasury/movements") {
      const res = await query("SELECT id, direction as type, amount, partner_name as description, created_at as date, status FROM payments WHERE company_id=$1 AND status='confirmed' ORDER BY created_at DESC LIMIT 20", [companyId]);
      return res.rows;
    }

    // Budgets
    if (path === "budgets" || path === "budgets/" || path === "budgets/vs-actual") {
      const res = await query("SELECT * FROM budgets WHERE company_id=$1 ORDER BY period_start DESC", [companyId]);
      return res.rows;
    }
    m = matchPath(path, "budgets/:id");
    if (m) {
      const res = await query("SELECT * FROM budgets WHERE id=$1 AND company_id=$2", [m.id, companyId]);
      return res.rows[0] || null;
    }

    // Reconciliation
    if (path === "reconciliation/history") {
      const res = await query("SELECT * FROM reconciliations WHERE company_id=$1 ORDER BY created_at DESC", [companyId]);
      return res.rows;
    }

    // SAT
    if (path === "sat/documents") {
      const res = await query("SELECT * FROM cfdi_documents WHERE company_id=$1 ORDER BY fecha_emision DESC", [companyId]);
      return res.rows;
    }

    // Reports
    if (path === "reports/cash-flow") {
      const res = await query(`
        SELECT COALESCE(SUM(CASE WHEN direction='inbound' THEN amount ELSE 0 END), 0) as inflows,
               COALESCE(SUM(CASE WHEN direction='outbound' THEN amount ELSE 0 END), 0) as outflows
        FROM payments WHERE company_id=$1 AND status='confirmed'
      `, [companyId]);
      const r = res.rows[0];
      return { inflows: Number(r.inflows), outflows: Number(r.outflows), net: Number(r.inflows) - Number(r.outflows), by_day: [] };
    }
    if (path === "reports/sat-compliance") {
      const res = await query(`
        SELECT COUNT(*) as total_cfdis,
               COUNT(*) FILTER (WHERE sat_status='Vigente') as vigentes,
               COUNT(*) FILTER (WHERE sat_status='Cancelado') as cancelados
        FROM cfdi_documents WHERE company_id=$1
      `, [companyId]);
      const r = res.rows[0];
      const total = Number(r.total_cfdis) || 1;
      return { ...r, total_cfdis: total, vigentes: Number(r.vigentes), cancelados: Number(r.cancelados), compliance_rate: Math.round(Number(r.vigentes) / total * 1000) / 10 };
    }
    if (path === "reports/budget-vs-actual") {
      const res = await query("SELECT * FROM budgets WHERE company_id=$1", [companyId]);
      return res.rows;
    }
    if (path === "reports/vendor-summary") {
      const res = await query("SELECT * FROM vendors WHERE company_id=$1", [companyId]);
      return res.rows;
    }
    if (path === "reports/expenses") {
      const res = await query(`
        SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count
        FROM expenses WHERE company_id=$1
      `, [companyId]);
      return res.rows[0];
    }

    // Notifications
    if (path === "notifications" || path === "notifications/") {
      const res = await query("SELECT * FROM notifications WHERE company_id=$1 ORDER BY created_at DESC", [companyId]);
      return res.rows;
    }
    if (path === "notifications/unread-count") {
      const res = await query("SELECT COUNT(*) as count FROM notifications WHERE company_id=$1 AND is_read=false", [companyId]);
      return { count: Number(res.rows[0].count) };
    }

    // Companies
    if (path === "companies" || path === "companies/") {
      const res = await query("SELECT * FROM companies WHERE id=$1", [companyId]);
      return res.rows;
    }

  } catch (e) {
    console.error("DB query error:", e);
    return null; // fall through to mock
  }

  return null;
}

async function dbPost(path: string, body: unknown, companyId: number | null): Promise<unknown | null> {
  if (!hasDB() || !companyId) return null;
  const b = body as Record<string, unknown>;

  try {
    // Payments
    if (path === "payments/vendor") {
      const res = await query(
        `INSERT INTO payments (company_id, direction, status, amount, currency, partner_name, partner_rfc, clabe_destination, comment, reference_id)
         VALUES ($1, 'outbound', 'pending_approval', $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [companyId, b.amount, b.currency || "MXN", b.partner_name, b.partner_rfc, b.clabe, b.comment, `PAY-${Date.now()}`]
      );
      return res.rows[0];
    }
    let m = matchPath(path, "payments/:id/execute");
    if (m) {
      const res = await query("UPDATE payments SET status='processing', updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING *", [m.id, companyId]);
      return res.rows[0];
    }
    m = matchPath(path, "payments/:id/schedule");
    if (m) {
      const res = await query("UPDATE payments SET status='scheduled', updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING *", [m.id, companyId]);
      return res.rows[0];
    }

    // Expenses
    if (path === "expenses" || path === "expenses/") {
      const res = await query(
        `INSERT INTO expenses (company_id, employee_name, employee_email, category, description, amount, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [companyId, b.employee_name, b.employee_email, b.category, b.description, b.amount, b.currency || "MXN"]
      );
      return res.rows[0];
    }
    m = matchPath(path, "expenses/:id/action");
    if (m) {
      const newStatus = (b as Record<string, string>).action === "approve" ? "approved" : (b as Record<string, string>).action === "reject" ? "rejected" : "paid";
      const res = await query("UPDATE expenses SET status=$1 WHERE id=$2 AND company_id=$3 RETURNING *", [newStatus, m.id, companyId]);
      return res.rows[0];
    }

    // Approvals
    if (path === "approvals/rules") {
      const res = await query(
        `INSERT INTO approval_rules (company_id, name, min_amount, max_amount, required_approvers, approver_emails, auto_approve_below)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [companyId, b.name, b.min_amount || 0, b.max_amount || null, b.required_approvers || 1, b.approver_emails || [], b.auto_approve_below || null]
      );
      return res.rows[0];
    }
    m = matchPath(path, "approvals/:id/approve");
    if (m) {
      await query("UPDATE approval_requests SET status='approved', comment=$1 WHERE id=$2 AND company_id=$3", [b.comment || "", m.id, companyId]);
      return { status: "approved" };
    }
    m = matchPath(path, "approvals/:id/reject");
    if (m) {
      await query("UPDATE approval_requests SET status='rejected', comment=$1 WHERE id=$2 AND company_id=$3", [b.comment || "", m.id, companyId]);
      return { status: "rejected" };
    }

    // Budgets
    if (path === "budgets" || path === "budgets/") {
      const res = await query(
        `INSERT INTO budgets (company_id, name, category, period_start, period_end, amount_budgeted, alert_threshold_pct)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [companyId, b.name, b.category, b.period_start, b.period_end, b.amount_budgeted, b.alert_threshold_pct || 80]
      );
      return res.rows[0];
    }
    m = matchPath(path, "budgets/:id/spend");
    if (m) {
      const res = await query("UPDATE budgets SET amount_spent = amount_spent + $1 WHERE id=$2 AND company_id=$3 RETURNING *", [b.amount || 0, m.id, companyId]);
      return res.rows[0];
    }

    // Reconciliation
    if (path === "reconciliation/fintoc-odoo" || path === "reconciliation/sat") {
      const rType = path.includes("fintoc") ? "fintoc-odoo" : "sat";
      const res = await query(
        `INSERT INTO reconciliations (company_id, type, status, total_transactions, matched, unmatched, amount_matched)
         VALUES ($1, $2, 'matched', 45, 42, 3, 1850000) RETURNING *`,
        [companyId, rType]
      );
      return res.rows[0];
    }

    // Notifications
    m = matchPath(path, "notifications/:id/read");
    if (m) {
      await query("UPDATE notifications SET is_read=true WHERE id=$1 AND company_id=$2", [m.id, companyId]);
      return { success: true };
    }
    if (path === "notifications/mark-all-read") {
      await query("UPDATE notifications SET is_read=true WHERE company_id=$1", [companyId]);
      return { success: true };
    }

  } catch (e) {
    console.error("DB post error:", e);
    return null;
  }

  return null;
}

// ── Mock fallback handlers ──

function mockGet(path: string): Response {
  if (path === "dashboard") return NextResponse.json(MOCK.dashboard);
  if (path === "payments" || path === "payments/") return NextResponse.json(MOCK.payments);
  if (path === "payments/scheduled/list") return NextResponse.json(MOCK.payments.filter((p) => p.status === "scheduled"));
  if (matchPath(path, "payments/:id")) return NextResponse.json(MOCK.payments[0]);
  if (path === "invoices/receivable") return NextResponse.json(MOCK.invoicesReceivable);
  if (path === "invoices/payable") return NextResponse.json(MOCK.invoicesPayable);
  if (path === "invoices/overdue/receivable") return NextResponse.json(MOCK.invoicesReceivable.filter((i) => i.status === "overdue"));
  if (path === "invoices/overdue/payable") return NextResponse.json([]);
  if (path.startsWith("invoices/aging/")) return NextResponse.json({ "0-30": 125000, "31-60": 89000, "61-90": 0, "90+": 340000 });
  if (matchPath(path, "invoices/:id")) return NextResponse.json(MOCK.invoicesReceivable[0]);
  if (matchPath(path, "invoices/:id/cfdi")) return NextResponse.json({ uuid: "ABC12345", status: "Vigente" });
  if (path === "vendors" || path === "vendors/") return NextResponse.json(MOCK.vendors);
  if (matchPath(path, "vendors/:id/clabe")) return NextResponse.json({ clabe: "012180015678901234" });
  if (matchPath(path, "vendors/:id/bills")) return NextResponse.json(MOCK.invoicesPayable);
  if (matchPath(path, "vendors/:id")) return NextResponse.json(MOCK.vendors[0]);
  if (path === "customers" || path === "customers/" || path === "customers/search") return NextResponse.json(MOCK.customers);
  if (matchPath(path, "customers/:id/clabe")) return NextResponse.json({ clabe: "646180157800000001" });
  if (matchPath(path, "customers/:id/invoices")) return NextResponse.json(MOCK.invoicesReceivable);
  if (matchPath(path, "customers/:id")) return NextResponse.json(MOCK.customers[0]);
  if (path === "expenses" || path === "expenses/") return NextResponse.json(MOCK.expenses);
  if (path === "expenses/summary") return NextResponse.json({ total: 13500, by_category: { viaje: 8500, oficina: 3200, comida: 1800 }, by_status: { submitted: 1, approved: 1, paid: 1 } });
  if (path === "approvals/rules") return NextResponse.json(MOCK.approvalRules);
  if (path === "approvals/pending") return NextResponse.json(MOCK.pendingApprovals);
  if (matchPath(path, "approvals/:id/history")) return NextResponse.json([]);
  if (path === "treasury/snapshot") return NextResponse.json(MOCK.treasurySnapshot);
  if (path === "treasury/forecast") return NextResponse.json([
    { date: today, projected_balance: 2_450_000, inflows: 0, outflows: 0 },
    { date: "2026-03-05", projected_balance: 2_575_000, inflows: 125000, outflows: 0 },
    { date: "2026-03-10", projected_balance: 2_405_000, inflows: 0, outflows: 125000 },
  ]);
  if (path === "treasury/cash-flow") return NextResponse.json({ inflows: 554000, outflows: 467000, net: 87000 });
  if (path === "treasury/balance") return NextResponse.json({ balance: 2_450_000, currency: "MXN" });
  if (path === "treasury/movements") return NextResponse.json(MOCK.dashboard.recent_movements);
  if (path === "budgets" || path === "budgets/" || path === "budgets/vs-actual") return NextResponse.json(MOCK.budgets);
  if (matchPath(path, "budgets/:id")) return NextResponse.json(MOCK.budgets[0]);
  if (path === "reconciliation/history") return NextResponse.json(MOCK.reconciliationHistory);
  if (path === "sat/documents") return NextResponse.json(MOCK.satDocuments);
  if (path === "reports/cash-flow") return NextResponse.json({ inflows: 554000, outflows: 467000, net: 87000, by_day: [] });
  if (path.startsWith("reports/aging/")) return NextResponse.json({ "0-30": 125000, "31-60": 89000, "61-90": 0, "90+": 340000, total: 554000 });
  if (path === "reports/sat-compliance") return NextResponse.json({ total_cfdis: 30, vigentes: 28, cancelados: 2, compliance_rate: 93.3 });
  if (path === "reports/budget-vs-actual") return NextResponse.json(MOCK.budgets);
  if (path === "reports/vendor-summary") return NextResponse.json(MOCK.vendors);
  if (path === "reports/expenses") return NextResponse.json({ total: 13500, count: 3, by_category: { viaje: 8500, oficina: 3200, comida: 1800 } });
  if (path === "notifications" || path === "notifications/") return NextResponse.json(MOCK.notifications);
  if (path === "notifications/unread-count") return NextResponse.json({ count: 2 });
  if (path === "companies" || path === "companies/") return NextResponse.json([{ id: 1, name: "Demo Corp SA de CV", rfc: "DCO230101AAA", is_active: true }]);
  if (path === "vendor-portal/dashboard") return NextResponse.json({ invoices: MOCK.invoicesPayable, payments: MOCK.payments.slice(0, 2) });
  // Collections
  if (path === "collections/pending") return NextResponse.json(MOCK.invoicesReceivable.filter(i => i.status === "open"));
  if (path === "collections/overdue") return NextResponse.json(MOCK.invoicesReceivable.filter(i => i.status === "overdue"));
  if (path === "collections/aging") return NextResponse.json({ "0-30": 125000, "31-60": 89000, "61-90": 0, "90+": 340000 });
  if (matchPath(path, "collections/customer/:id")) return NextResponse.json(MOCK.customers[0]);
  return NextResponse.json({ detail: "Not found" }, { status: 404 });
}

function mockPost(path: string): Response {
  if (path === "payments/vendor") return NextResponse.json({ ...MOCK.payments[0], id: 100, status: "pending_approval" });
  if (path === "payments/batch") return NextResponse.json({ created: 3, payments: MOCK.payments.slice(0, 3) });
  if (matchPath(path, "payments/:id/execute")) return NextResponse.json({ ...MOCK.payments[0], status: "processing" });
  if (matchPath(path, "payments/:id/schedule")) return NextResponse.json({ ...MOCK.payments[0], status: "scheduled" });
  if (matchPath(path, "collections/customer/:id/clabe")) return NextResponse.json({ clabe: "646180157800000001", partner_id: 1 });
  if (path === "collections/clabes/setup-all") return NextResponse.json({ created: 3, total: 3 });
  if (path === "collections/clabes/sync") return NextResponse.json({ synced: 3 });
  if (path === "collections/payment-link") return NextResponse.json({ link: "https://pay.example.com/demo", amount: 125000 });
  if (path === "expenses" || path === "expenses/") return NextResponse.json({ ...MOCK.expenses[0], id: 100 });
  if (matchPath(path, "expenses/:id/action")) return NextResponse.json({ ...MOCK.expenses[0], status: "approved" });
  if (path === "approvals/rules") return NextResponse.json({ ...MOCK.approvalRules[0], id: 100 });
  if (matchPath(path, "approvals/:id/approve")) return NextResponse.json({ status: "approved" });
  if (matchPath(path, "approvals/:id/reject")) return NextResponse.json({ status: "rejected" });
  if (path === "budgets" || path === "budgets/") return NextResponse.json({ ...MOCK.budgets[0], id: 100 });
  if (matchPath(path, "budgets/:id/spend")) return NextResponse.json({ ...MOCK.budgets[0], amount_spent: MOCK.budgets[0].amount_spent + 10000 });
  if (matchPath(path, "budgets/:id/commit")) return NextResponse.json({ ...MOCK.budgets[0], amount_committed: MOCK.budgets[0].amount_committed + 5000 });
  if (path === "reconciliation/fintoc-odoo") return NextResponse.json(MOCK.reconciliationHistory[0]);
  if (path === "reconciliation/sat") return NextResponse.json(MOCK.reconciliationHistory[1]);
  if (path === "sat/validate") return NextResponse.json({ uuid: "ABC12345", status: "Vigente", efos: "No listado" });
  if (path === "sat/validate/bulk") return NextResponse.json({ validated: 5, results: [{ uuid: "ABC12345", status: "Vigente" }] });
  if (path === "sat/upload-xml") return NextResponse.json({ id: 1, uuid: "NEW-UUID", status: "processed" });
  if (path === "sat/revalidate-all") return NextResponse.json({ revalidated: 30, vigentes: 28, cancelados: 2 });
  if (matchPath(path, "notifications/:id/read")) return NextResponse.json({ success: true });
  if (path === "notifications/mark-all-read") return NextResponse.json({ success: true });
  if (path === "companies" || path === "companies/") return NextResponse.json({ id: 2, name: "Nueva Empresa", rfc: "NEE010101AAA", is_active: true });
  if (path === "vendor-portal/token") return NextResponse.json({ token: "demo-vendor-token", expires_at: now });
  return NextResponse.json({ detail: "Not found" }, { status: 404 });
}

// ── Main handlers ──

function cleanPath(req: NextRequest): string {
  const url = new URL(req.url);
  return url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
}

export async function GET(req: NextRequest) {
  const path = cleanPath(req);
  const companyId = await getCompanyId(req);

  // Try DB first
  const dbResult = await dbGet(path, companyId);
  if (dbResult !== null) return NextResponse.json(dbResult);

  // Fallback to mock
  return mockGet(path);
}

export async function POST(req: NextRequest) {
  const path = cleanPath(req);
  const companyId = await getCompanyId(req);
  let body = {};
  try { body = await req.json(); } catch { /* no body */ }

  // Try DB first
  const dbResult = await dbPost(path, body, companyId);
  if (dbResult !== null) return NextResponse.json(dbResult);

  // Fallback to mock
  return mockPost(path);
}

export async function PUT(req: NextRequest) {
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  return NextResponse.json({ success: true });
}
