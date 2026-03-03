import { NextRequest, NextResponse } from "next/server";

/**
 * Catch-all API route that returns realistic mock data for all backend endpoints.
 * This lets the entire app run on Vercel without a separate backend.
 */

const now = new Date().toISOString();
const today = now.slice(0, 10);

// ── Mock Data ──

const dashboardData = {
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
};

const payments = [
  { id: 1, direction: "outbound", status: "confirmed", amount: 45000, currency: "MXN", partner_name: "Materiales MX SA", partner_rfc: "MMX010101AAA", reference_id: "PAY-001", created_at: now },
  { id: 2, direction: "outbound", status: "pending_approval", amount: 125000, currency: "MXN", partner_name: "Logística Express", partner_rfc: "LEX020202BBB", reference_id: "PAY-002", created_at: now },
  { id: 3, direction: "inbound", status: "confirmed", amount: 89000, currency: "MXN", partner_name: "TechCorp SA de CV", partner_rfc: "TCS030303CCC", reference_id: "PAY-003", created_at: now },
  { id: 4, direction: "outbound", status: "draft", amount: 67000, currency: "MXN", partner_name: "Servicios Cloud MX", partner_rfc: "SCM040404DDD", reference_id: "PAY-004", created_at: now },
  { id: 5, direction: "outbound", status: "scheduled", amount: 230000, currency: "MXN", partner_name: "Distribuidora Nacional", partner_rfc: "DNA050505EEE", reference_id: "PAY-005", scheduled_date: today, created_at: now },
];

const invoicesReceivable = [
  { id: 1, partner_name: "Acme SA de CV", partner_rfc: "ACM010101AAA", amount_total: 125000, amount_residual: 125000, date_invoice: today, date_due: "2026-03-15", status: "open", cfdi_uuid: "ABC12345" },
  { id: 2, partner_name: "TechCorp SA", partner_rfc: "TCS020202BBB", amount_total: 89000, amount_residual: 0, date_invoice: today, date_due: "2026-03-20", status: "paid", cfdi_uuid: "DEF67890" },
  { id: 3, partner_name: "Global Trade MX", partner_rfc: "GTM030303CCC", amount_total: 340000, amount_residual: 340000, date_invoice: today, date_due: "2026-02-28", status: "overdue", cfdi_uuid: "GHI11111" },
];

const invoicesPayable = [
  { id: 4, partner_name: "Materiales MX SA", partner_rfc: "MMX010101AAA", amount_total: 45000, amount_residual: 45000, date_invoice: today, date_due: "2026-03-10", status: "open", cfdi_uuid: "JKL22222" },
  { id: 5, partner_name: "Logística Express", partner_rfc: "LEX020202BBB", amount_total: 125000, amount_residual: 125000, date_invoice: today, date_due: "2026-03-18", status: "open", cfdi_uuid: "MNO33333" },
];

const vendors = [
  { id: 1, name: "Materiales MX SA de CV", rfc: "MMX010101AAA", email: "pagos@materiales.mx", clabe: "012180015678901234", total_payable: 45000, bills_count: 2 },
  { id: 2, name: "Logística Express SA", rfc: "LEX020202BBB", email: "finanzas@logistica.mx", clabe: "014320012345678901", total_payable: 125000, bills_count: 3 },
  { id: 3, name: "Servicios Cloud MX", rfc: "SCM040404DDD", email: "billing@cloud.mx", clabe: "021180098765432109", total_payable: 67000, bills_count: 1 },
  { id: 4, name: "Distribuidora Nacional SA", rfc: "DNA050505EEE", email: "cxp@distribuidora.mx", clabe: "072180045678901234", total_payable: 230000, bills_count: 4 },
];

const customers = [
  { id: 1, name: "Acme SA de CV", rfc: "ACM010101AAA", email: "pagos@acme.mx", clabe: "646180157800000001", total_receivable: 125000, invoices_count: 2 },
  { id: 2, name: "TechCorp SA de CV", rfc: "TCS020202BBB", email: "finanzas@techcorp.mx", clabe: "646180157800000002", total_receivable: 89000, invoices_count: 1 },
  { id: 3, name: "Global Trade MX SA", rfc: "GTM030303CCC", email: "admin@globaltrade.mx", clabe: "646180157800000003", total_receivable: 340000, invoices_count: 3 },
];

const expenses = [
  { id: 1, employee_name: "María García", category: "viaje", description: "Viaje a Monterrey", amount: 8500, currency: "MXN", status: "submitted", created_at: now },
  { id: 2, employee_name: "Carlos López", category: "oficina", description: "Material de oficina", amount: 3200, currency: "MXN", status: "approved", created_at: now },
  { id: 3, employee_name: "Ana Rodríguez", category: "comida", description: "Comida con cliente", amount: 1800, currency: "MXN", status: "paid", created_at: now },
];

const approvalRules = [
  { id: 1, name: "Pagos mayores a $50,000", min_amount: 50000, max_amount: null, required_approvers: 1, approver_emails: ["director@empresa.com"], auto_approve_below: 50000, is_active: true },
  { id: 2, name: "Pagos mayores a $500,000", min_amount: 500000, max_amount: null, required_approvers: 2, approver_emails: ["director@empresa.com", "cfo@empresa.com"], auto_approve_below: null, is_active: true },
];

const pendingApprovals = [
  { id: 1, payment_id: 2, status: "pending", level: 1, approver_email: "director@empresa.com", amount: 125000, partner_name: "Logística Express", created_at: now },
];

const treasurySnapshot = {
  total_balance: 2_450_000,
  available_balance: 2_100_000,
  reserved_balance: 350_000,
  accounts: [
    { name: "Cuenta Principal SPEI", balance: 1_800_000, currency: "MXN", bank: "STP" },
    { name: "Cuenta Operativa", balance: 650_000, currency: "MXN", bank: "BBVA" },
  ],
  pending_inflows: 554_000,
  pending_outflows: 467_000,
};

const treasuryForecast = [
  { date: today, projected_balance: 2_450_000, inflows: 0, outflows: 0 },
  { date: "2026-03-04", projected_balance: 2_575_000, inflows: 125000, outflows: 0 },
  { date: "2026-03-05", projected_balance: 2_530_000, inflows: 0, outflows: 45000 },
  { date: "2026-03-10", projected_balance: 2_405_000, inflows: 0, outflows: 125000 },
];

const budgets = [
  { id: 1, name: "Marketing Q1", category: "marketing", period_start: "2026-01-01", period_end: "2026-03-31", amount_budgeted: 500000, amount_spent: 320000, amount_committed: 80000, alert_threshold_pct: 80, is_active: true },
  { id: 2, name: "Operaciones Q1", category: "operaciones", period_start: "2026-01-01", period_end: "2026-03-31", amount_budgeted: 1200000, amount_spent: 890000, amount_committed: 150000, alert_threshold_pct: 90, is_active: true },
  { id: 3, name: "IT Q1", category: "tecnología", period_start: "2026-01-01", period_end: "2026-03-31", amount_budgeted: 300000, amount_spent: 210000, amount_committed: 40000, alert_threshold_pct: 85, is_active: true },
];

const notifications = [
  { id: 1, notification_type: "payment_received", title: "Pago recibido", message: "Se recibió pago de $125,000 de Acme SA", is_read: false, created_at: now },
  { id: 2, notification_type: "approval_required", title: "Aprobación pendiente", message: "Pago de $125,000 a Logística Express requiere aprobación", is_read: false, created_at: now },
  { id: 3, notification_type: "invoice_overdue", title: "Factura vencida", message: "Factura de Global Trade MX por $340,000 está vencida", is_read: true, created_at: now },
];

const reconciliationHistory = [
  { id: 1, type: "fintoc-odoo", status: "matched", total_transactions: 45, matched: 42, unmatched: 3, amount_matched: 1_850_000, created_at: now },
  { id: 2, type: "sat", status: "matched", total_transactions: 30, matched: 28, unmatched: 2, amount_matched: 2_100_000, created_at: now },
];

const satDocuments = [
  { id: 1, uuid: "ABC12345-XXXX-YYYY-ZZZZ-000000000001", tipo_comprobante: "I", rfc_emisor: "ACM010101AAA", nombre_emisor: "Acme SA", total: 125000, sat_status: "Vigente", fecha_emision: now },
  { id: 2, uuid: "DEF67890-XXXX-YYYY-ZZZZ-000000000002", tipo_comprobante: "I", rfc_emisor: "TCS020202BBB", nombre_emisor: "TechCorp", total: 89000, sat_status: "Vigente", fecha_emision: now },
];

// ── Route handler ──

function matchPath(path: string, pattern: string): Record<string, string> | null {
  const pathParts = path.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function handleGet(path: string): Response {
  // Dashboard
  if (path === "dashboard") return NextResponse.json(dashboardData);

  // Payments
  if (path === "payments" || path === "payments/") return NextResponse.json(payments);
  if (path === "payments/scheduled/list") return NextResponse.json(payments.filter((p) => p.status === "scheduled"));
  if (matchPath(path, "payments/:id")) return NextResponse.json(payments[0]);

  // Invoices
  if (path === "invoices/receivable") return NextResponse.json(invoicesReceivable);
  if (path === "invoices/payable") return NextResponse.json(invoicesPayable);
  if (path === "invoices/overdue/receivable") return NextResponse.json(invoicesReceivable.filter((i) => i.status === "overdue"));
  if (path === "invoices/overdue/payable") return NextResponse.json([]);
  if (path.startsWith("invoices/aging/")) return NextResponse.json({ "0-30": 125000, "31-60": 89000, "61-90": 0, "90+": 340000 });
  if (matchPath(path, "invoices/:id")) return NextResponse.json(invoicesReceivable[0]);
  if (matchPath(path, "invoices/:id/cfdi")) return NextResponse.json({ uuid: "ABC12345", status: "Vigente" });

  // Vendors
  if (path === "vendors" || path === "vendors/") return NextResponse.json(vendors);
  if (matchPath(path, "vendors/:id/clabe")) return NextResponse.json({ clabe: "012180015678901234" });
  if (matchPath(path, "vendors/:id/bills")) return NextResponse.json(invoicesPayable);
  if (matchPath(path, "vendors/:id")) return NextResponse.json(vendors[0]);

  // Customers
  if (path === "customers" || path === "customers/") return NextResponse.json(customers);
  if (path === "customers/search") return NextResponse.json(customers);
  if (matchPath(path, "customers/:id/clabe")) return NextResponse.json({ clabe: "646180157800000001" });
  if (matchPath(path, "customers/:id/invoices")) return NextResponse.json(invoicesReceivable);
  if (matchPath(path, "customers/:id")) return NextResponse.json(customers[0]);

  // Expenses
  if (path === "expenses" || path === "expenses/") return NextResponse.json(expenses);
  if (path === "expenses/summary") return NextResponse.json({ total: 13500, by_category: { viaje: 8500, oficina: 3200, comida: 1800 }, by_status: { submitted: 1, approved: 1, paid: 1 } });

  // Approvals
  if (path === "approvals/rules") return NextResponse.json(approvalRules);
  if (path === "approvals/pending") return NextResponse.json(pendingApprovals);
  if (matchPath(path, "approvals/:id/history")) return NextResponse.json([]);

  // Treasury
  if (path === "treasury/snapshot") return NextResponse.json(treasurySnapshot);
  if (path === "treasury/forecast") return NextResponse.json(treasuryForecast);
  if (path === "treasury/cash-flow") return NextResponse.json({ inflows: 554000, outflows: 467000, net: 87000 });
  if (path === "treasury/balance") return NextResponse.json({ balance: 2_450_000, currency: "MXN" });
  if (path === "treasury/movements") return NextResponse.json(dashboardData.recent_movements);

  // Budgets
  if (path === "budgets" || path === "budgets/") return NextResponse.json(budgets);
  if (path === "budgets/vs-actual") return NextResponse.json(budgets);
  if (matchPath(path, "budgets/:id")) return NextResponse.json(budgets[0]);

  // Reconciliation
  if (path === "reconciliation/history") return NextResponse.json(reconciliationHistory);

  // SAT
  if (path === "sat/documents") return NextResponse.json(satDocuments);

  // Reports
  if (path === "reports/cash-flow") return NextResponse.json({ inflows: 554000, outflows: 467000, net: 87000, by_day: [] });
  if (path.startsWith("reports/aging/")) return NextResponse.json({ "0-30": 125000, "31-60": 89000, "61-90": 0, "90+": 340000, total: 554000 });
  if (path === "reports/sat-compliance") return NextResponse.json({ total_cfdis: 30, vigentes: 28, cancelados: 2, compliance_rate: 93.3 });
  if (path === "reports/budget-vs-actual") return NextResponse.json(budgets);
  if (path === "reports/vendor-summary") return NextResponse.json(vendors);
  if (path === "reports/expenses") return NextResponse.json({ total: 13500, count: 3, by_category: { viaje: 8500, oficina: 3200, comida: 1800 } });

  // Notifications
  if (path === "notifications" || path === "notifications/") return NextResponse.json(notifications);
  if (path === "notifications/unread-count") return NextResponse.json({ count: 2 });

  // Companies
  if (path === "companies" || path === "companies/") return NextResponse.json([{ id: 1, name: "Demo Corp SA de CV", rfc: "DCO230101AAA", is_active: true }]);

  // Vendor Portal
  if (path === "vendor-portal/dashboard") return NextResponse.json({ invoices: invoicesPayable, payments: payments.slice(0, 2) });

  return NextResponse.json({ detail: "Not found" }, { status: 404 });
}

function handlePost(path: string): Response {
  // Payments
  if (path === "payments/vendor") return NextResponse.json({ ...payments[0], id: 100, status: "pending_approval" });
  if (path === "payments/batch") return NextResponse.json({ created: 3, payments: payments.slice(0, 3) });
  if (matchPath(path, "payments/:id/execute")) return NextResponse.json({ ...payments[0], status: "processing" });
  if (matchPath(path, "payments/:id/schedule")) return NextResponse.json({ ...payments[0], status: "scheduled" });

  // Collections
  if (matchPath(path, "collections/customer/:id/clabe")) return NextResponse.json({ clabe: "646180157800000001", partner_id: 1 });
  if (path === "collections/clabes/setup-all") return NextResponse.json({ created: 3, total: 3 });
  if (path === "collections/clabes/sync") return NextResponse.json({ synced: 3 });
  if (path === "collections/payment-link") return NextResponse.json({ link: "https://pay.fintoc.com/demo-link", amount: 125000 });

  // Expenses
  if (path === "expenses" || path === "expenses/") return NextResponse.json({ ...expenses[0], id: 100 });
  if (matchPath(path, "expenses/:id/action")) return NextResponse.json({ ...expenses[0], status: "approved" });

  // Approvals
  if (path === "approvals/rules") return NextResponse.json({ ...approvalRules[0], id: 100 });
  if (matchPath(path, "approvals/:id/approve")) return NextResponse.json({ status: "approved" });
  if (matchPath(path, "approvals/:id/reject")) return NextResponse.json({ status: "rejected" });

  // Budgets
  if (path === "budgets" || path === "budgets/") return NextResponse.json({ ...budgets[0], id: 100 });
  if (matchPath(path, "budgets/:id/spend")) return NextResponse.json({ ...budgets[0], amount_spent: budgets[0].amount_spent + 10000 });
  if (matchPath(path, "budgets/:id/commit")) return NextResponse.json({ ...budgets[0], amount_committed: budgets[0].amount_committed + 5000 });

  // Reconciliation
  if (path === "reconciliation/fintoc-odoo") return NextResponse.json(reconciliationHistory[0]);
  if (path === "reconciliation/sat") return NextResponse.json(reconciliationHistory[1]);

  // SAT
  if (path === "sat/validate") return NextResponse.json({ uuid: "ABC12345", status: "Vigente", efos: "No listado" });
  if (path === "sat/validate/bulk") return NextResponse.json({ validated: 5, results: [{ uuid: "ABC12345", status: "Vigente" }] });
  if (path === "sat/upload-xml") return NextResponse.json({ id: 1, uuid: "NEW-UUID", status: "processed" });
  if (path === "sat/revalidate-all") return NextResponse.json({ revalidated: 30, vigentes: 28, cancelados: 2 });

  // Notifications
  if (matchPath(path, "notifications/:id/read")) return NextResponse.json({ success: true });
  if (path === "notifications/mark-all-read") return NextResponse.json({ success: true });

  // Companies
  if (path === "companies" || path === "companies/") return NextResponse.json({ id: 2, name: "Nueva Empresa", rfc: "NEE010101AAA", is_active: true });

  // Vendor Portal
  if (path === "vendor-portal/token") return NextResponse.json({ token: "demo-vendor-token", expires_at: now });

  return NextResponse.json({ detail: "Not found" }, { status: 404 });
}

// Strip /api/ prefix and query string
function cleanPath(req: NextRequest): string {
  const url = new URL(req.url);
  return url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
}

export async function GET(req: NextRequest) {
  return handleGet(cleanPath(req));
}

export async function POST(req: NextRequest) {
  return handlePost(cleanPath(req));
}

export async function PUT(req: NextRequest) {
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  return NextResponse.json({ success: true });
}
