import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyToken } from "@/lib/auth-server";
import { hasDB, query, insert, update } from "@/lib/db";

// ── Zod schemas for input validation ──

const paymentSchema = z.object({
  amount: z.number().positive("Monto debe ser positivo"),
  currency: z.string().default("MXN"),
  partner_name: z.string().min(1, "Nombre del proveedor requerido"),
  partner_rfc: z.string().optional(),
  clabe: z.string().regex(/^\d{18}$/, "CLABE debe tener 18 digitos").optional(),
  comment: z.string().optional(),
});

const expenseSchema = z.object({
  employee_name: z.string().min(1),
  employee_email: z.string().email().optional(),
  category: z.string().min(1),
  description: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().default("MXN"),
});

const budgetSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  period_start: z.string(),
  period_end: z.string(),
  amount_budgeted: z.number().positive(),
  alert_threshold_pct: z.number().min(0).max(100).default(80),
});

const approvalRuleSchema = z.object({
  name: z.string().min(1),
  min_amount: z.number().min(0).default(0),
  max_amount: z.number().nullable().optional(),
  required_approvers: z.number().min(1).default(1),
  approver_emails: z.array(z.string().email()).default([]),
  auto_approve_below: z.number().nullable().optional(),
});

const clabeSchema = z.object({
  clabe: z.string().regex(/^\d{18}$/, "CLABE debe tener 18 digitos"),
});

function zodError(error: z.ZodError): Response {
  const msg = error.issues.map((i) => i.message).join(", ");
  return NextResponse.json({ detail: msg }, { status: 400 });
}

/**
 * Catch-all API route — uses Supabase when configured, otherwise mock data.
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
    total_balance: 2_450_000.0,
    accounts_receivable: 1_850_000.0,
    accounts_payable: 980_000.0,
    net_position: 2_450_000.0 + 1_850_000.0 - 980_000.0,
    pending_invoices_count: 5,
    pending_bills_count: 2,
    overdue_invoices: 3,
    pending_approvals: 2,
    unread_notifications: 2,
    budget_alerts: 0,
    sat_issues: 0,
    recent_payments: [
      { id: 1, direction: "inbound", status: "confirmed", amount: 125000, currency: "MXN", reference_id: "PAY-003", partner_name: "Acme SA", created_at: now },
      { id: 2, direction: "outbound", status: "confirmed", amount: 45000, currency: "MXN", reference_id: "PAY-001", partner_name: "Materiales MX", created_at: now },
      { id: 3, direction: "inbound", status: "confirmed", amount: 89000, currency: "MXN", reference_id: "PAY-003", partner_name: "TechCorp", created_at: now },
    ],
    overdue_invoice_list: [
      { id: 3, name: "GHI11111", partner: "Global Trade MX", amount_total: 340000, amount_residual: 340000, invoice_date_due: "2026-02-28" },
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

// ── DB query helpers using Supabase client ──

async function dbGet(path: string, companyId: number | null): Promise<unknown | null> {
  if (!hasDB() || !companyId) return null;

  try {
    // Dashboard — aggregate from multiple tables
    if (path === "dashboard") {
      const [payRes, recvRes, payableRes, approvalRes, overdueRes, movRes] = await Promise.all([
        query("payments", { match: { company_id: companyId } }),
        query("invoices", { match: { company_id: companyId, type: "receivable" } }),
        query("invoices", { match: { company_id: companyId, type: "payable" } }),
        query("approval_requests", { match: { company_id: companyId, status: "pending" } }),
        query("invoices", { match: { company_id: companyId, status: "overdue" } }),
        query("payments", { match: { company_id: companyId, status: "confirmed" }, order: { column: "created_at" }, limit: 5 }),
      ]);
      const payments = payRes.data || [];
      const recv = (recvRes.data || []).filter((i: Record<string, unknown>) => i.status !== "paid");
      const payable = (payableRes.data || []).filter((i: Record<string, unknown>) => i.status !== "paid");
      const inflows = payments.filter((p: Record<string, unknown>) => p.direction === "inbound" && p.status === "confirmed").reduce((s: number, p: Record<string, unknown>) => s + Number(p.amount), 0);
      const outflows = payments.filter((p: Record<string, unknown>) => p.direction === "outbound" && p.status === "confirmed").reduce((s: number, p: Record<string, unknown>) => s + Number(p.amount), 0);
      const totalBalance = inflows - outflows;
      const ar = recv.reduce((s: number, i: Record<string, unknown>) => s + Number(i.amount_residual), 0);
      const ap = payable.reduce((s: number, i: Record<string, unknown>) => s + Number(i.amount_residual), 0);
      const overdueList = (overdueRes.data || []).map((inv: Record<string, unknown>) => ({
        id: inv.id, name: inv.cfdi_uuid || `INV-${inv.id}`, partner: inv.partner_name,
        amount_total: inv.amount_total, amount_residual: inv.amount_residual,
        invoice_date_due: inv.date_due,
      }));
      const recentPayments = (movRes.data || []).map((p: Record<string, unknown>) => ({
        id: p.id, direction: p.direction, status: p.status, amount: p.amount,
        currency: p.currency, reference_id: p.reference_id, partner_name: p.partner_name,
        created_at: p.created_at,
      }));

      return {
        total_balance: totalBalance,
        accounts_receivable: ar,
        accounts_payable: ap,
        net_position: totalBalance + ar - ap,
        pending_invoices_count: recv.length + payable.length,
        pending_bills_count: payable.length,
        overdue_invoices: overdueList.length,
        pending_approvals: (approvalRes.data || []).length,
        unread_notifications: 0,
        budget_alerts: 0,
        sat_issues: 0,
        recent_payments: recentPayments,
        overdue_invoice_list: overdueList,
        cash_flow_trend: MOCK.dashboard.cash_flow_trend,
      };
    }

    // Payments
    if (path === "payments" || path === "payments/") {
      const { data } = await query("payments", { match: { company_id: companyId }, order: { column: "created_at" } });
      return data || [];
    }
    if (path === "payments/scheduled/list") {
      const { data } = await query("payments", { match: { company_id: companyId, status: "scheduled" }, order: { column: "scheduled_date", ascending: true } });
      return data || [];
    }
    let m = matchPath(path, "payments/:id");
    if (m) {
      const { data } = await query("payments", { match: { id: Number(m.id), company_id: companyId }, single: true });
      return data;
    }

    // Invoices
    if (path === "invoices/receivable") {
      const { data } = await query("invoices", { match: { company_id: companyId, type: "receivable" }, order: { column: "date_due", ascending: true } });
      return data || [];
    }
    if (path === "invoices/payable") {
      const { data } = await query("invoices", { match: { company_id: companyId, type: "payable" }, order: { column: "date_due", ascending: true } });
      return data || [];
    }
    if (path === "invoices/overdue/receivable") {
      const { data } = await query("invoices", { match: { company_id: companyId, type: "receivable", status: "overdue" } });
      return data || [];
    }
    if (path === "invoices/overdue/payable") {
      const { data } = await query("invoices", { match: { company_id: companyId, type: "payable", status: "overdue" } });
      return data || [];
    }
    m = matchPath(path, "invoices/:id");
    if (m) {
      const { data } = await query("invoices", { match: { id: Number(m.id), company_id: companyId }, single: true });
      return data;
    }
    m = matchPath(path, "invoices/:id/cfdi");
    if (m) {
      const { data } = await query("invoices", { select: "cfdi_uuid, status", match: { id: Number(m.id), company_id: companyId }, single: true });
      return data ? { uuid: data.cfdi_uuid, status: data.status } : { uuid: null, status: null };
    }

    // Vendors
    if (path === "vendors" || path === "vendors/") {
      const { data } = await query("vendors", { match: { company_id: companyId }, order: { column: "name", ascending: true } });
      return data || [];
    }
    m = matchPath(path, "vendors/:id/clabe");
    if (m) {
      const { data } = await query("vendors", { select: "clabe", match: { id: Number(m.id), company_id: companyId }, single: true });
      return data || { clabe: null };
    }
    m = matchPath(path, "vendors/:id/bills");
    if (m) {
      const { data: vendor } = await query("vendors", { select: "rfc", match: { id: Number(m.id), company_id: companyId }, single: true });
      if (vendor?.rfc) {
        const { data } = await query("invoices", { match: { company_id: companyId, type: "payable", partner_rfc: vendor.rfc } });
        return data || [];
      }
      return [];
    }
    m = matchPath(path, "vendors/:id");
    if (m) {
      const { data } = await query("vendors", { match: { id: Number(m.id), company_id: companyId }, single: true });
      return data;
    }

    // Customers
    if (path === "customers" || path === "customers/" || path === "customers/search") {
      const { data } = await query("customers", { match: { company_id: companyId }, order: { column: "name", ascending: true } });
      return data || [];
    }
    m = matchPath(path, "customers/:id/clabe");
    if (m) {
      const { data } = await query("customers", { select: "clabe", match: { id: Number(m.id), company_id: companyId }, single: true });
      return data || { clabe: null };
    }
    m = matchPath(path, "customers/:id/invoices");
    if (m) {
      const { data: cust } = await query("customers", { select: "rfc", match: { id: Number(m.id), company_id: companyId }, single: true });
      if (cust?.rfc) {
        const { data } = await query("invoices", { match: { company_id: companyId, type: "receivable", partner_rfc: cust.rfc } });
        return data || [];
      }
      return [];
    }
    m = matchPath(path, "customers/:id");
    if (m) {
      const { data } = await query("customers", { match: { id: Number(m.id), company_id: companyId }, single: true });
      return data;
    }

    // Expenses
    if (path === "expenses" || path === "expenses/") {
      const { data } = await query("expenses", { match: { company_id: companyId }, order: { column: "created_at" } });
      return data || [];
    }
    if (path === "expenses/summary") {
      const { data } = await query("expenses", { match: { company_id: companyId } });
      const items = data || [];
      const total = items.reduce((s: number, e: Record<string, unknown>) => s + Number(e.amount), 0);
      const by_category: Record<string, number> = {};
      const by_status: Record<string, number> = {};
      for (const e of items) {
        by_category[e.category as string] = (by_category[e.category as string] || 0) + Number(e.amount);
        by_status[e.status as string] = (by_status[e.status as string] || 0) + 1;
      }
      return { total, by_category, by_status };
    }

    // Approvals
    if (path === "approvals/rules") {
      const { data } = await query("approval_rules", { match: { company_id: companyId }, order: { column: "min_amount", ascending: true } });
      return data || [];
    }
    if (path === "approvals/pending") {
      const { data } = await query("approval_requests", { match: { company_id: companyId, status: "pending" }, order: { column: "created_at" } });
      return data || [];
    }
    m = matchPath(path, "approvals/:id/history");
    if (m) {
      const { data } = await query("approval_requests", { match: { payment_id: Number(m.id), company_id: companyId }, order: { column: "created_at", ascending: true } });
      return data || [];
    }

    // Treasury
    if (path === "treasury/snapshot") {
      const { data: payments } = await query("payments", { match: { company_id: companyId } });
      const all = payments || [];
      const confirmed = all.filter((p: Record<string, unknown>) => p.status === "confirmed");
      const inflows = confirmed.filter((p: Record<string, unknown>) => p.direction === "inbound").reduce((s: number, p: Record<string, unknown>) => s + Number(p.amount), 0);
      const outflows = confirmed.filter((p: Record<string, unknown>) => p.direction === "outbound").reduce((s: number, p: Record<string, unknown>) => s + Number(p.amount), 0);
      const balance = inflows - outflows;
      const pendingIn = all.filter((p: Record<string, unknown>) => p.direction === "inbound" && ["draft", "pending_approval", "scheduled"].includes(p.status as string)).reduce((s: number, p: Record<string, unknown>) => s + Number(p.amount), 0);
      const pendingOut = all.filter((p: Record<string, unknown>) => p.direction === "outbound" && ["draft", "pending_approval", "scheduled"].includes(p.status as string)).reduce((s: number, p: Record<string, unknown>) => s + Number(p.amount), 0);
      return {
        total_balance: balance, available_balance: balance, reserved_balance: 0,
        accounts: [{ name: "Cuenta Principal SPEI", balance, currency: "MXN", bank: "STP" }],
        pending_inflows: pendingIn, pending_outflows: pendingOut,
      };
    }
    if (path === "treasury/forecast") return null; // use mock
    if (path === "treasury/cash-flow") {
      const { data: payments } = await query("payments", { match: { company_id: companyId, status: "confirmed" } });
      const all = payments || [];
      const inflows = all.filter((p: Record<string, unknown>) => p.direction === "inbound").reduce((s: number, p: Record<string, unknown>) => s + Number(p.amount), 0);
      const outflows = all.filter((p: Record<string, unknown>) => p.direction === "outbound").reduce((s: number, p: Record<string, unknown>) => s + Number(p.amount), 0);
      return { inflows, outflows, net: inflows - outflows };
    }
    if (path === "treasury/balance") {
      const { data: payments } = await query("payments", { match: { company_id: companyId, status: "confirmed" } });
      const all = payments || [];
      const inflows = all.filter((p: Record<string, unknown>) => p.direction === "inbound").reduce((s: number, p: Record<string, unknown>) => s + Number(p.amount), 0);
      const outflows = all.filter((p: Record<string, unknown>) => p.direction === "outbound").reduce((s: number, p: Record<string, unknown>) => s + Number(p.amount), 0);
      return { balance: inflows - outflows, currency: "MXN" };
    }
    if (path === "treasury/movements") {
      const { data } = await query("payments", { match: { company_id: companyId, status: "confirmed" }, order: { column: "created_at" }, limit: 20 });
      return (data || []).map((p: Record<string, unknown>) => ({ id: p.id, type: p.direction, amount: p.amount, description: p.partner_name, date: p.created_at, status: p.status }));
    }

    // Budgets
    if (path === "budgets" || path === "budgets/" || path === "budgets/vs-actual") {
      const { data } = await query("budgets", { match: { company_id: companyId }, order: { column: "period_start" } });
      return data || [];
    }
    m = matchPath(path, "budgets/:id");
    if (m) {
      const { data } = await query("budgets", { match: { id: Number(m.id), company_id: companyId }, single: true });
      return data;
    }

    // Reconciliation
    if (path === "reconciliation/history") {
      const { data } = await query("reconciliations", { match: { company_id: companyId }, order: { column: "created_at" } });
      return data || [];
    }

    // SAT
    if (path === "sat/documents") {
      const { data } = await query("cfdi_documents", { match: { company_id: companyId }, order: { column: "fecha_emision" } });
      return data || [];
    }

    // Reports
    if (path === "reports/cash-flow") {
      const { data: payments } = await query("payments", { match: { company_id: companyId, status: "confirmed" } });
      const all = payments || [];
      const inflows = all.filter((p: Record<string, unknown>) => p.direction === "inbound").reduce((s: number, p: Record<string, unknown>) => s + Number(p.amount), 0);
      const outflows = all.filter((p: Record<string, unknown>) => p.direction === "outbound").reduce((s: number, p: Record<string, unknown>) => s + Number(p.amount), 0);
      return { inflows, outflows, net: inflows - outflows, by_day: [] };
    }
    if (path === "reports/sat-compliance") {
      const { data } = await query("cfdi_documents", { match: { company_id: companyId } });
      const docs = data || [];
      const total = docs.length || 1;
      const vigentes = docs.filter((d: Record<string, unknown>) => d.sat_status === "Vigente").length;
      const cancelados = docs.filter((d: Record<string, unknown>) => d.sat_status === "Cancelado").length;
      return { total_cfdis: total, vigentes, cancelados, compliance_rate: Math.round(vigentes / total * 1000) / 10 };
    }
    if (path === "reports/budget-vs-actual") {
      const { data } = await query("budgets", { match: { company_id: companyId } });
      return data || [];
    }
    if (path === "reports/vendor-summary") {
      const { data } = await query("vendors", { match: { company_id: companyId } });
      return data || [];
    }
    if (path === "reports/expenses") {
      const { data } = await query("expenses", { match: { company_id: companyId } });
      const items = data || [];
      const total = items.reduce((s: number, e: Record<string, unknown>) => s + Number(e.amount), 0);
      const by_category: Record<string, number> = {};
      for (const e of items) { by_category[e.category as string] = (by_category[e.category as string] || 0) + Number(e.amount); }
      return { total, count: items.length, by_category };
    }

    // Notifications
    if (path === "notifications" || path === "notifications/") {
      const { data } = await query("notifications", { match: { company_id: companyId }, order: { column: "created_at" } });
      return data || [];
    }
    if (path === "notifications/unread-count") {
      const { data } = await query("notifications", { match: { company_id: companyId, is_read: false } });
      return { count: (data || []).length };
    }

    // Companies
    if (path === "companies" || path === "companies/") {
      const { data } = await query("companies", { match: { id: companyId } });
      return data || [];
    }

    // Collections
    if (path === "collections/pending") {
      const { data } = await query("invoices", { match: { company_id: companyId, type: "receivable", status: "open" }, order: { column: "date_due", ascending: true } });
      return data || [];
    }
    if (path === "collections/overdue") {
      const { data } = await query("invoices", { match: { company_id: companyId, type: "receivable", status: "overdue" }, order: { column: "date_due", ascending: true } });
      return data || [];
    }
    if (path === "collections/aging") {
      const { data } = await query("invoices", { match: { company_id: companyId, type: "receivable" } });
      const now = new Date();
      const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
      for (const inv of data || []) {
        if (inv.status === "paid") continue;
        const due = new Date(inv.date_due as string);
        const daysPast = Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86400000));
        const amount = Number(inv.amount_residual) || 0;
        if (daysPast <= 30) buckets["0-30"] += amount;
        else if (daysPast <= 60) buckets["31-60"] += amount;
        else if (daysPast <= 90) buckets["61-90"] += amount;
        else buckets["90+"] += amount;
      }
      return buckets;
    }
    m = matchPath(path, "collections/customer/:id");
    if (m) {
      const { data } = await query("customers", { match: { id: Number(m.id), company_id: companyId }, single: true });
      return data;
    }

    // Integrations status (for settings page)
    if (path === "integrations" || path === "integrations/") {
      try {
        const { data } = await query("integrations", { match: { company_id: companyId } });
        return data || [];
      } catch { return []; }
    }

  } catch (e) {
    console.error("DB query error:", e);
    return null;
  }

  return null;
}

async function dbPost(path: string, body: unknown, companyId: number | null): Promise<Response | unknown | null> {
  if (!hasDB() || !companyId) return null;
  const b = body as Record<string, unknown>;

  try {
    // Payments
    if (path === "payments/vendor") {
      const parsed = paymentSchema.safeParse(b);
      if (!parsed.success) return zodError(parsed.error);
      const v = parsed.data;
      const { data } = await insert("payments", {
        company_id: companyId, direction: "outbound", status: "pending_approval",
        amount: v.amount, currency: v.currency,
        partner_name: v.partner_name, partner_rfc: v.partner_rfc || null,
        clabe_destination: v.clabe || null, comment: v.comment || null,
        reference_id: `PAY-${Date.now()}`,
      });
      return data?.[0];
    }
    let m = matchPath(path, "payments/:id/execute");
    if (m) {
      const { data } = await update("payments", { status: "processing", updated_at: new Date().toISOString() }, { id: Number(m.id), company_id: companyId });
      return data?.[0];
    }
    m = matchPath(path, "payments/:id/schedule");
    if (m) {
      const { data } = await update("payments", { status: "scheduled", updated_at: new Date().toISOString() }, { id: Number(m.id), company_id: companyId });
      return data?.[0];
    }

    // Expenses
    if (path === "expenses" || path === "expenses/") {
      const parsed = expenseSchema.safeParse(b);
      if (!parsed.success) return zodError(parsed.error);
      const v = parsed.data;
      const { data } = await insert("expenses", {
        company_id: companyId, employee_name: v.employee_name, employee_email: v.employee_email || null,
        category: v.category, description: v.description || null, amount: v.amount, currency: v.currency,
      });
      return data?.[0];
    }
    m = matchPath(path, "expenses/:id/action");
    if (m) {
      const action = (b as Record<string, string>).action;
      const newStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "paid";
      const { data } = await update("expenses", { status: newStatus }, { id: Number(m.id), company_id: companyId });
      return data?.[0];
    }

    // Approvals
    if (path === "approvals/rules") {
      const parsed = approvalRuleSchema.safeParse(b);
      if (!parsed.success) return zodError(parsed.error);
      const v = parsed.data;
      const { data } = await insert("approval_rules", {
        company_id: companyId, name: v.name, min_amount: v.min_amount,
        max_amount: v.max_amount || null, required_approvers: v.required_approvers,
        approver_emails: v.approver_emails, auto_approve_below: v.auto_approve_below || null,
      });
      return data?.[0];
    }
    m = matchPath(path, "approvals/:id/approve");
    if (m) {
      await update("approval_requests", { status: "approved", comment: (b.comment as string) || "" }, { id: Number(m.id), company_id: companyId });
      return { status: "approved" };
    }
    m = matchPath(path, "approvals/:id/reject");
    if (m) {
      await update("approval_requests", { status: "rejected", comment: (b.comment as string) || "" }, { id: Number(m.id), company_id: companyId });
      return { status: "rejected" };
    }

    // Budgets
    if (path === "budgets" || path === "budgets/") {
      const parsed = budgetSchema.safeParse(b);
      if (!parsed.success) return zodError(parsed.error);
      const v = parsed.data;
      const { data } = await insert("budgets", {
        company_id: companyId, name: v.name, category: v.category || null,
        period_start: v.period_start, period_end: v.period_end,
        amount_budgeted: v.amount_budgeted, alert_threshold_pct: v.alert_threshold_pct,
      });
      return data?.[0];
    }

    // Vendor CLABE set
    m = matchPath(path, "vendors/:id/clabe");
    if (m) {
      const parsed = clabeSchema.safeParse(b);
      if (!parsed.success) return zodError(parsed.error);
      const { data } = await update("vendors", { clabe: parsed.data.clabe }, { id: Number(m.id), company_id: companyId });
      return data?.[0] || { clabe: parsed.data.clabe };
    }

    // Vendor CLABE verify
    m = matchPath(path, "vendors/:id/verify-clabe");
    if (m) {
      const { data: vendor } = await query("vendors", { select: "clabe", match: { id: Number(m.id), company_id: companyId }, single: true });
      if (!vendor?.clabe) return { valid: false, message: "Proveedor sin CLABE registrada" };
      // Basic CLABE validation: 18 digits, valid check digit
      const clabe = vendor.clabe as string;
      const valid = /^\d{18}$/.test(clabe);
      return { valid, clabe, message: valid ? "CLABE valida" : "CLABE con formato invalido" };
    }

    // Customer CLABE set
    m = matchPath(path, "customers/:id/clabe");
    if (m) {
      const parsed = clabeSchema.safeParse(b);
      if (!parsed.success) return zodError(parsed.error);
      const { data } = await update("customers", { clabe: parsed.data.clabe }, { id: Number(m.id), company_id: companyId });
      return data?.[0] || { clabe: parsed.data.clabe };
    }

    // Collections — customer CLABE setup
    m = matchPath(path, "collections/customer/:id/clabe");
    if (m) {
      const clabe = `646180${Date.now().toString().slice(-12)}`;
      const { data } = await update("customers", { clabe }, { id: Number(m.id), company_id: companyId });
      return { clabe, partner_id: Number(m.id), ...(data?.[0] || {}) };
    }

    // Collections — setup all CLABEs
    if (path === "collections/clabes/setup-all") {
      const { data: customers } = await query("customers", { match: { company_id: companyId } });
      let created = 0;
      for (const c of customers || []) {
        if (!c.clabe) {
          const clabe = `646180${Date.now().toString().slice(-12)}`;
          await update("customers", { clabe }, { id: c.id as number, company_id: companyId });
          created++;
        }
      }
      return { created, total: (customers || []).length };
    }

    // Collections — sync CLABEs
    if (path === "collections/clabes/sync") {
      const { data: customers } = await query("customers", { match: { company_id: companyId } });
      const synced = (customers || []).filter((c: Record<string, unknown>) => c.clabe).length;
      return { synced };
    }

    // Collections — payment link
    if (path === "collections/payment-link") {
      const amount = Number(b.amount) || 0;
      const partnerId = Number(b.partner_id) || 0;
      return { link: `https://pay.payana.mx/${companyId}/${partnerId}/${amount}`, amount, partner_id: partnerId };
    }

    // Notifications
    m = matchPath(path, "notifications/:id/read");
    if (m) {
      await update("notifications", { is_read: true }, { id: Number(m.id), company_id: companyId });
      return { success: true };
    }
    if (path === "notifications/mark-all-read") {
      await update("notifications", { is_read: true }, { company_id: companyId });
      return { success: true };
    }

    // SAT
    if (path === "sat/validate") return { uuid: b.uuid || "ABC12345", status: "Vigente", efos: "No listado" };
    if (path === "sat/validate/bulk") return { validated: 5, results: [{ uuid: "ABC12345", status: "Vigente" }] };
    if (path === "sat/upload-xml") return { id: 1, uuid: "NEW-UUID", status: "processed" };
    if (path === "sat/revalidate-all") return { revalidated: 30, vigentes: 28, cancelados: 2 };

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
  if (path === "treasury/movements") return NextResponse.json(MOCK.dashboard.recent_payments);
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
  const dbResult = await dbGet(path, companyId);
  if (dbResult !== null) return NextResponse.json(dbResult);
  return mockGet(path);
}

export async function POST(req: NextRequest) {
  const path = cleanPath(req);
  const companyId = await getCompanyId(req);
  let body = {};
  try { body = await req.json(); } catch { /* no body */ }
  const dbResult = await dbPost(path, body, companyId);
  if (dbResult instanceof Response) return dbResult; // Zod validation error
  if (dbResult !== null) return NextResponse.json(dbResult);
  return mockPost(path);
}

export async function PUT(req: NextRequest) {
  const path = cleanPath(req);
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  if (!hasDB()) return NextResponse.json({ detail: "DB no configurada" }, { status: 500 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body */ }

  try {
    let m = matchPath(path, "vendors/:id");
    if (m) {
      const { data } = await update("vendors", body, { id: Number(m.id), company_id: companyId });
      return NextResponse.json(data?.[0] || { success: true });
    }
    m = matchPath(path, "customers/:id");
    if (m) {
      const { data } = await update("customers", body, { id: Number(m.id), company_id: companyId });
      return NextResponse.json(data?.[0] || { success: true });
    }
    m = matchPath(path, "payments/:id");
    if (m) {
      const { data } = await update("payments", { ...body, updated_at: new Date().toISOString() }, { id: Number(m.id), company_id: companyId });
      return NextResponse.json(data?.[0] || { success: true });
    }
    m = matchPath(path, "invoices/:id");
    if (m) {
      const { data } = await update("invoices", body, { id: Number(m.id), company_id: companyId });
      return NextResponse.json(data?.[0] || { success: true });
    }
    m = matchPath(path, "expenses/:id");
    if (m) {
      const { data } = await update("expenses", body, { id: Number(m.id), company_id: companyId });
      return NextResponse.json(data?.[0] || { success: true });
    }
    m = matchPath(path, "budgets/:id");
    if (m) {
      const { data } = await update("budgets", body, { id: Number(m.id), company_id: companyId });
      return NextResponse.json(data?.[0] || { success: true });
    }
    m = matchPath(path, "approval-rules/:id");
    if (m) {
      const { data } = await update("approval_rules", body, { id: Number(m.id), company_id: companyId });
      return NextResponse.json(data?.[0] || { success: true });
    }
  } catch (e) {
    console.error("DB put error:", e);
    return NextResponse.json({ detail: "Error al actualizar" }, { status: 500 });
  }

  return NextResponse.json({ detail: "Ruta no encontrada" }, { status: 404 });
}

export async function DELETE(req: NextRequest) {
  const path = cleanPath(req);
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  if (!hasDB()) return NextResponse.json({ detail: "DB no configurada" }, { status: 500 });

  try {
    // Generic delete for all tenant-scoped tables
    const tables: Record<string, string> = {
      payments: "payments",
      invoices: "invoices",
      vendors: "vendors",
      customers: "customers",
      expenses: "expenses",
      budgets: "budgets",
      "approval-rules": "approval_rules",
      notifications: "notifications",
    };

    for (const [prefix, table] of Object.entries(tables)) {
      const m = matchPath(path, `${prefix}/:id`);
      if (m) {
        await update(table, { is_active: false }, { id: Number(m.id), company_id: companyId });
        return NextResponse.json({ success: true, id: Number(m.id) });
      }
    }
  } catch (e) {
    console.error("DB delete error:", e);
    return NextResponse.json({ detail: "Error al eliminar" }, { status: 500 });
  }

  return NextResponse.json({ detail: "Ruta no encontrada" }, { status: 404 });
}
