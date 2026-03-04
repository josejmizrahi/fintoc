import { NextRequest, NextResponse } from "next/server";
import { hasDB, query, insert, update } from "@/lib/db";
import { getCompanyId } from "@/lib/auth-helpers";
import { validateCfdiAgainstSat } from "@/lib/sat";
import { odooJsonRpc } from "@/lib/odoo";

// GET /api/reconciliation — returns history
export async function GET(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/reconciliation\/?/, "");

  if (!hasDB()) return NextResponse.json([]);

  if (path === "history" || path === "") {
    const { data } = await query("reconciliations", { match: { company_id: companyId }, order: { column: "created_at" }, limit: 100 });
    return NextResponse.json(data || []);
  }

  const entryMatch = path.match(/^(\d+)\/entries$/);
  if (entryMatch) {
    try {
      const { data } = await query("reconciliation_entries", { match: { company_id: companyId, reconciliation_id: Number(entryMatch[1]) }, order: { column: "created_at" } });
      return NextResponse.json(data || []);
    } catch { return NextResponse.json([]); }
  }

  return NextResponse.json({ detail: "Not found" }, { status: 404 });
}

// POST /api/reconciliation — run reconciliation
export async function POST(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  if (!hasDB()) return NextResponse.json({ detail: "DB no configurada" }, { status: 500 });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/reconciliation\/?/, "");
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body */ }
  const days = Number(body.days || url.searchParams.get("days") || 7);

  if (path === "fintoc-odoo") return reconcileFintocOdoo(companyId, days);
  if (path === "sat") return reconcileSat(companyId, days);
  return NextResponse.json({ detail: "Not found" }, { status: 404 });
}

// ── Reconciliation entry type ──

interface ReconEntry {
  payment_ref: string;
  amount_erp: number;
  amount_bank: number;
  difference: number;
  status: "matched" | "unmatched" | "partial";
  cfdi_uuid: string | null;
  sat_status: string | null;
  notes: string;
}

// ── Fintoc vs Odoo Reconciliation ──

async function reconcileFintocOdoo(companyId: number, days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const { data: payments } = await query("payments", { match: { company_id: companyId }, order: { column: "created_at" } });
  const allPayments = (payments || []).filter((p: Record<string, unknown>) => new Date(p.created_at as string) >= cutoff);

  // Check Odoo integration
  let odooConfig: Record<string, string> | null = null;
  try {
    const { data: integration } = await query("integrations", { match: { company_id: companyId, provider: "odoo" }, single: true });
    if (integration?.is_connected && integration.config) {
      odooConfig = integration.config as Record<string, string>;
    }
  } catch { /* no integrations table */ }

  let odooPayments: Record<string, unknown>[] = [];
  if (odooConfig) {
    odooPayments = await fetchOdooPayments(odooConfig, days);
  }

  const odooByRef = new Map<string, Record<string, unknown>>();
  for (const op of odooPayments) {
    const ref = (op.ref as string) || (op.name as string) || "";
    if (ref) odooByRef.set(ref.toLowerCase(), op);
  }

  const entries: ReconEntry[] = [];
  let matched = 0, unmatched = 0, partial = 0, totalDiscrepancy = 0;
  const matchedOdooRefs = new Set<string>();

  for (const payment of allPayments) {
    const ref = ((payment.reference_id as string) || "").toLowerCase();
    const amount = Number(payment.amount) || 0;
    const cfdiUuid = (payment.cfdi_uuid as string) || null;
    const satStatus = (payment.sat_status as string) || null;
    const odooMatch = ref ? odooByRef.get(ref) : null;

    if (odooMatch) {
      matchedOdooRefs.add(ref);
      const odooAmount = Number(odooMatch.amount) || 0;
      const diff = Math.abs(amount - odooAmount);
      const threshold = Math.max(amount, odooAmount) * 0.001;

      if (diff <= threshold) {
        entries.push({ payment_ref: (payment.reference_id as string) || `PAY-${payment.id}`, amount_erp: odooAmount, amount_bank: amount, difference: 0, status: "matched", cfdi_uuid: cfdiUuid, sat_status: satStatus, notes: `Matched with Odoo ref: ${odooMatch.name || ref}` });
        matched++;
      } else {
        entries.push({ payment_ref: (payment.reference_id as string) || `PAY-${payment.id}`, amount_erp: odooAmount, amount_bank: amount, difference: amount - odooAmount, status: "partial", cfdi_uuid: cfdiUuid, sat_status: satStatus, notes: `Amount mismatch: bank=${amount}, ERP=${odooAmount}, diff=${diff.toFixed(2)}` });
        partial++;
        totalDiscrepancy += diff;
      }
    } else if (!odooConfig) {
      if (payment.status === "confirmed") {
        entries.push({ payment_ref: (payment.reference_id as string) || `PAY-${payment.id}`, amount_erp: amount, amount_bank: amount, difference: 0, status: "matched", cfdi_uuid: cfdiUuid, sat_status: satStatus, notes: "Self-reconciled (no Odoo connected)" });
        matched++;
      } else {
        entries.push({ payment_ref: (payment.reference_id as string) || `PAY-${payment.id}`, amount_erp: 0, amount_bank: amount, difference: amount, status: "unmatched", cfdi_uuid: cfdiUuid, sat_status: satStatus, notes: `Unconfirmed payment (status: ${payment.status})` });
        unmatched++;
        totalDiscrepancy += amount;
      }
    } else {
      entries.push({ payment_ref: (payment.reference_id as string) || `PAY-${payment.id}`, amount_erp: 0, amount_bank: amount, difference: amount, status: "unmatched", cfdi_uuid: cfdiUuid, sat_status: satStatus, notes: "No matching Odoo payment found" });
      unmatched++;
      totalDiscrepancy += amount;
    }
  }

  // Odoo payments not in our DB
  for (const op of odooPayments) {
    const ref = ((op.ref as string) || (op.name as string) || "").toLowerCase();
    if (ref && !matchedOdooRefs.has(ref)) {
      const odooAmount = Number(op.amount) || 0;
      entries.push({ payment_ref: (op.name as string) || ref, amount_erp: odooAmount, amount_bank: 0, difference: -odooAmount, status: "unmatched", cfdi_uuid: null, sat_status: null, notes: "Odoo payment not found in bank records" });
      unmatched++;
      totalDiscrepancy += odooAmount;
    }
  }

  return storeAndReturn(companyId, "fintoc-odoo", days, entries, matched, unmatched, partial, totalDiscrepancy);
}

// ── SAT Reconciliation ──

async function reconcileSat(companyId: number, days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const { data: cfdis } = await query("cfdi_documents", { match: { company_id: companyId }, order: { column: "fecha_emision" } });
  const allCfdis = (cfdis || []).filter((c: Record<string, unknown>) => new Date(c.fecha_emision as string) >= cutoff);
  const { data: invoices } = await query("invoices", { match: { company_id: companyId }, order: { column: "created_at" } });
  const recentInvoices = (invoices || []).filter((i: Record<string, unknown>) => new Date(i.created_at as string) >= cutoff && i.cfdi_uuid);

  let companyRfc = "";
  try {
    const { data: integration } = await query("integrations", { match: { company_id: companyId, provider: "sat" }, single: true });
    if (integration?.config) companyRfc = (integration.config as Record<string, string>).rfcEmisor || "";
  } catch { /* no table */ }
  if (!companyRfc) {
    const { data: company } = await query("companies", { match: { id: companyId }, single: true });
    companyRfc = (company?.rfc as string) || "";
  }

  const entries: ReconEntry[] = [];
  let matched = 0, unmatched = 0, partial = 0, totalDiscrepancy = 0;

  for (const cfdi of allCfdis) {
    const uuid = cfdi.uuid as string;
    const total = Number(cfdi.total) || 0;
    let validatedStatus = (cfdi.sat_status as string) || "Desconocido";

    if (companyRfc && uuid) {
      validatedStatus = await validateCfdiAgainstSat(uuid, (cfdi.rfc_emisor as string) || companyRfc, (cfdi.rfc_receptor as string) || companyRfc, String(total));
      if (validatedStatus !== (cfdi.sat_status as string)) {
        await update("cfdi_documents", { sat_status: validatedStatus }, { id: cfdi.id as number, company_id: companyId });
      }
    }

    if (validatedStatus === "Vigente") {
      entries.push({ payment_ref: uuid, amount_erp: total, amount_bank: total, difference: 0, status: "matched", cfdi_uuid: uuid, sat_status: validatedStatus, notes: "CFDI vigente en SAT" });
      matched++;
    } else if (validatedStatus === "Cancelado") {
      entries.push({ payment_ref: uuid, amount_erp: total, amount_bank: 0, difference: total, status: "unmatched", cfdi_uuid: uuid, sat_status: validatedStatus, notes: "CFDI cancelado en SAT" });
      unmatched++;
      totalDiscrepancy += total;
    } else {
      entries.push({ payment_ref: uuid, amount_erp: total, amount_bank: total, difference: 0, status: "partial", cfdi_uuid: uuid, sat_status: validatedStatus, notes: `Estado SAT: ${validatedStatus}` });
      partial++;
    }
  }

  // Invoices with CFDI not in cfdi_documents
  for (const inv of recentInvoices) {
    const uuid = inv.cfdi_uuid as string;
    if (allCfdis.some((c: Record<string, unknown>) => c.uuid === uuid)) continue;
    if (!uuid) {
      const total = Number(inv.amount_total) || 0;
      entries.push({ payment_ref: `INV-${inv.id}`, amount_erp: total, amount_bank: 0, difference: total, status: "unmatched", cfdi_uuid: "-", sat_status: "Sin complemento", notes: "Factura sin UUID de CFDI" });
      unmatched++;
      totalDiscrepancy += total;
    }
  }

  const result = await storeAndReturn(companyId, "sat", days, entries, matched, unmatched, partial, totalDiscrepancy);
  const body = await result.json();
  return NextResponse.json({ ...body, total: body.total_transactions, issues: unmatched + partial, ok: matched });
}

// ── Shared: store reconciliation + return response ──

async function storeAndReturn(companyId: number, type: string, days: number, entries: ReconEntry[], matched: number, unmatched: number, partial: number, totalDiscrepancy: number) {
  const totalTransactions = matched + unmatched + partial;
  const amountMatched = entries.filter((e) => e.status === "matched").reduce((s, e) => s + e.amount_bank, 0);

  const { data: reconData } = await insert("reconciliations", {
    company_id: companyId, type, status: unmatched === 0 && partial === 0 ? "matched" : "unmatched",
    total_transactions: totalTransactions, matched, unmatched, amount_matched: amountMatched, period_days: days, partial, total_discrepancy: totalDiscrepancy,
  });
  const reconId = reconData?.[0]?.id;

  if (reconId && entries.length > 0) {
    try {
      await insert("reconciliation_entries", entries.map((e) => ({
        company_id: companyId, reconciliation_id: reconId, source: type,
        payment_ref: e.payment_ref, amount_erp: e.amount_erp, amount_bank: e.amount_bank, difference: e.difference,
        status: e.status, cfdi_uuid: e.cfdi_uuid, sat_status: e.sat_status, notes: e.notes,
        matched_at: e.status === "matched" ? new Date().toISOString() : null,
      })));
    } catch { /* table might not exist */ }
  }

  return NextResponse.json({
    id: reconId, period_days: days, total_transactions: totalTransactions,
    matched, unmatched, partial, total_discrepancy: totalDiscrepancy, amount_matched: amountMatched,
    summary: { matched, unmatched, partial },
    entries: entries.map((e) => ({
      odoo_payment: e.payment_ref, amount_odoo: e.amount_erp, amount_fintoc: e.amount_bank,
      difference: e.difference, status: e.status, cfdi_uuid: e.cfdi_uuid || "-", sat_status: e.sat_status || "-", notes: e.notes,
    })),
  });
}

// ── Odoo payment fetcher ──

async function fetchOdooPayments(config: Record<string, string>, days: number): Promise<Record<string, unknown>[]> {
  const { url, database, user, password } = config;
  if (!url || !database || !user || !password) return [];
  try {
    const authResult = await odooJsonRpc(url, "common", "authenticate", [database, user, password, {}]);
    const uid = authResult.result as number | false;
    if (!uid) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const result = await odooJsonRpc(url, "object", "execute_kw", [
      database, uid, password, "account.payment", "search_read",
      [[["date", ">=", cutoff.toISOString().slice(0, 10)]]],
      { fields: ["name", "amount", "date", "ref", "state", "payment_type", "partner_id"], limit: 2000 },
    ], 30000);
    if (result.error) return [];
    return (result.result as Record<string, unknown>[]) || [];
  } catch { return []; }
}
