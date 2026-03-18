import { getAdminClient } from "@/lib/supabase/admin";
import { SupabaseClient } from "@supabase/supabase-js";

// ── Supabase Server Client (reuses shared admin singleton) ──

function getSupabase(): SupabaseClient | null {
  try {
    return getAdminClient();
  } catch {
    return null;
  }
}

export function hasDB(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ── Query helpers ──

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function query(
  table: string,
  options: {
    select?: string;
    match?: Record<string, unknown>;
    order?: { column: string; ascending?: boolean };
    limit?: number;
    single?: boolean;
  } = {}
): Promise<{ data: any; error: any }> {
  const sb = getSupabase();
  if (!sb) return { data: null, error: { message: "No Supabase configured" } };

  let q = sb.from(table).select(options.select || "*");

  if (options.match) {
    for (const [key, val] of Object.entries(options.match)) {
      q = q.eq(key, val);
    }
  }
  if (options.order) {
    q = q.order(options.order.column, {
      ascending: options.order.ascending ?? false,
    });
  }
  if (options.limit) {
    q = q.limit(options.limit);
  }
  if (options.single) {
    return q.single() as any;
  }
  return q as any;
}

export async function insert(
  table: string,
  data: Record<string, unknown> | Record<string, unknown>[]
): Promise<{ data: any; error: any }> {
  const sb = getSupabase();
  if (!sb) return { data: null, error: { message: "No Supabase configured" } };
  return sb.from(table).insert(data).select() as any;
}

export async function update(
  table: string,
  data: Record<string, unknown>,
  match: Record<string, unknown>
): Promise<{ data: any; error: any }> {
  const sb = getSupabase();
  if (!sb) return { data: null, error: { message: "No Supabase configured" } };
  let q = sb.from(table).update(data);
  for (const [key, val] of Object.entries(match)) {
    q = q.eq(key, val);
  }
  return q.select() as any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Seed demo data ──

export async function seedDB(companyId: number) {
  const sb = getSupabase();
  if (!sb) return { seeded: false, message: "No Supabase configured" };

  // Check if already seeded
  const { data: existing } = await sb
    .from("payments")
    .select("id")
    .eq("company_id", companyId)
    .limit(1);
  if (existing && existing.length > 0)
    return { seeded: false, message: "Already seeded" };

  // Seed all tables in parallel
  await Promise.all([
    sb.from("payments").insert([
      { company_id: companyId, direction: "outbound", status: "confirmed", amount: 45000, currency: "MXN", partner_name: "Materiales MX SA de CV", partner_rfc: "MMX010101AAA", reference_id: "PAY-001" },
      { company_id: companyId, direction: "outbound", status: "pending_approval", amount: 125000, currency: "MXN", partner_name: "Logística Express SA", partner_rfc: "LEX020202BBB", reference_id: "PAY-002" },
      { company_id: companyId, direction: "inbound", status: "confirmed", amount: 89000, currency: "MXN", partner_name: "TechCorp SA de CV", partner_rfc: "TCS030303CCC", reference_id: "PAY-003" },
      { company_id: companyId, direction: "outbound", status: "draft", amount: 67000, currency: "MXN", partner_name: "Servicios Cloud MX", partner_rfc: "SCM040404DDD", reference_id: "PAY-004" },
      { company_id: companyId, direction: "outbound", status: "scheduled", amount: 230000, currency: "MXN", partner_name: "Distribuidora Nacional SA", partner_rfc: "DNA050505EEE", reference_id: "PAY-005" },
    ]),
    sb.from("invoices").insert([
      { company_id: companyId, type: "receivable", partner_name: "Acme SA de CV", partner_rfc: "ACM010101AAA", amount_total: 125000, amount_residual: 125000, invoice_date: "2026-03-01", due_date: "2026-03-15", status: "open", cfdi_uuid: "ABC12345-0001" },
      { company_id: companyId, type: "receivable", partner_name: "TechCorp SA", partner_rfc: "TCS020202BBB", amount_total: 89000, amount_residual: 0, invoice_date: "2026-03-01", due_date: "2026-03-20", status: "paid", cfdi_uuid: "DEF67890-0002" },
      { company_id: companyId, type: "receivable", partner_name: "Global Trade MX", partner_rfc: "GTM030303CCC", amount_total: 340000, amount_residual: 340000, invoice_date: "2026-01-28", due_date: "2026-02-28", status: "overdue", cfdi_uuid: "GHI11111-0003" },
      { company_id: companyId, type: "payable", partner_name: "Materiales MX SA", partner_rfc: "MMX010101AAA", amount_total: 45000, amount_residual: 45000, invoice_date: "2026-03-01", due_date: "2026-03-10", status: "open", cfdi_uuid: "JKL22222-0004" },
      { company_id: companyId, type: "payable", partner_name: "Logística Express", partner_rfc: "LEX020202BBB", amount_total: 125000, amount_residual: 125000, invoice_date: "2026-03-01", due_date: "2026-03-18", status: "open", cfdi_uuid: "MNO33333-0005" },
    ]),
    sb.from("vendors").insert([
      { company_id: companyId, name: "Materiales MX SA de CV", rfc: "MMX010101AAA", email: "pagos@materiales.mx", clabe: "012180015678901234" },
      { company_id: companyId, name: "Logística Express SA", rfc: "LEX020202BBB", email: "finanzas@logistica.mx", clabe: "014320012345678901" },
      { company_id: companyId, name: "Servicios Cloud MX", rfc: "SCM040404DDD", email: "billing@cloud.mx", clabe: "021180098765432109" },
      { company_id: companyId, name: "Distribuidora Nacional SA", rfc: "DNA050505EEE", email: "cxp@distribuidora.mx", clabe: "072180045678901234" },
    ]),
    sb.from("customers").insert([
      { company_id: companyId, name: "Acme SA de CV", rfc: "ACM010101AAA", email: "pagos@acme.mx", clabe: "646180157800000001" },
      { company_id: companyId, name: "TechCorp SA de CV", rfc: "TCS020202BBB", email: "finanzas@techcorp.mx", clabe: "646180157800000002" },
      { company_id: companyId, name: "Global Trade MX SA", rfc: "GTM030303CCC", email: "admin@globaltrade.mx", clabe: "646180157800000003" },
    ]),
    sb.from("expenses").insert([
      { company_id: companyId, employee_name: "María García", employee_email: "maria@empresa.com", category: "viaje", description: "Viaje a Monterrey", amount: 8500, currency: "MXN", status: "submitted" },
      { company_id: companyId, employee_name: "Carlos López", employee_email: "carlos@empresa.com", category: "oficina", description: "Material de oficina", amount: 3200, currency: "MXN", status: "approved" },
      { company_id: companyId, employee_name: "Ana Rodríguez", employee_email: "ana@empresa.com", category: "comida", description: "Comida con cliente", amount: 1800, currency: "MXN", status: "paid" },
    ]),
    sb.from("approval_rules").insert([
      { company_id: companyId, name: "Pagos mayores a $50,000", min_amount: 50000, required_approvers: 1, approver_emails: ["director@empresa.com"], auto_approve_below: 50000 },
      { company_id: companyId, name: "Pagos mayores a $500,000", min_amount: 500000, required_approvers: 2, approver_emails: ["director@empresa.com", "cfo@empresa.com"] },
    ]),
    sb.from("budgets").insert([
      { company_id: companyId, name: "Marketing Q1", category: "marketing", period_start: "2026-01-01", period_end: "2026-03-31", amount_budgeted: 500000, amount_spent: 320000, amount_committed: 80000, alert_threshold_pct: 80 },
      { company_id: companyId, name: "Operaciones Q1", category: "operaciones", period_start: "2026-01-01", period_end: "2026-03-31", amount_budgeted: 1200000, amount_spent: 890000, amount_committed: 150000, alert_threshold_pct: 90 },
      { company_id: companyId, name: "IT Q1", category: "tecnología", period_start: "2026-01-01", period_end: "2026-03-31", amount_budgeted: 300000, amount_spent: 210000, amount_committed: 40000, alert_threshold_pct: 85 },
    ]),
    sb.from("notifications").insert([
      { company_id: companyId, notification_type: "payment_received", title: "Pago recibido", message: "Se recibió pago de $125,000 de Acme SA", is_read: false },
      { company_id: companyId, notification_type: "approval_required", title: "Aprobación pendiente", message: "Pago de $125,000 a Logística Express requiere aprobación", is_read: false },
      { company_id: companyId, notification_type: "invoice_overdue", title: "Factura vencida", message: "Factura de Global Trade MX por $340,000 está vencida", is_read: true },
    ]),
    sb.from("reconciliations").insert([
      { company_id: companyId, type: "fintoc-odoo", status: "matched", total_transactions: 45, matched: 42, unmatched: 3, amount_matched: 1850000 },
      { company_id: companyId, type: "sat", status: "matched", total_transactions: 30, matched: 28, unmatched: 2, amount_matched: 2100000 },
    ]),
  ]);

  return { seeded: true };
}
