import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth-server";
import { hasDB, query, insert, update } from "@/lib/db";

async function getCompanyId(req: NextRequest): Promise<number | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const payload = await verifyToken(auth.slice(7));
  return payload ? Number(payload.company_id) : null;
}

// GET /api/reconciliation — returns history
export async function GET(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/reconciliation\/?/, "");

  if (!hasDB()) {
    return NextResponse.json([]);
  }

  // GET /api/reconciliation/history
  if (path === "history" || path === "") {
    const { data } = await query("reconciliations", {
      match: { company_id: companyId },
      order: { column: "created_at" },
      limit: 100,
    });
    return NextResponse.json(data || []);
  }

  // GET /api/reconciliation/:id/entries
  const entryMatch = path.match(/^(\d+)\/entries$/);
  if (entryMatch) {
    const reconId = Number(entryMatch[1]);
    try {
      const { data } = await query("reconciliation_entries", {
        match: { company_id: companyId, reconciliation_id: reconId },
        order: { column: "created_at" },
      });
      return NextResponse.json(data || []);
    } catch {
      // Table might not exist yet
      return NextResponse.json([]);
    }
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

  if (path === "fintoc-odoo") {
    return reconcileFintocOdoo(companyId, days);
  }
  if (path === "sat") {
    return reconcileSat(companyId, days);
  }

  return NextResponse.json({ detail: "Not found" }, { status: 404 });
}

// ══════════════════════════════════════════════════════════
// Fintoc vs Odoo Reconciliation Engine
// ══════════════════════════════════════════════════════════
//
// Algorithm:
// 1. Fetch all payments from DB for the company in the period
// 2. Fetch integration config to check if Odoo is connected
// 3. If Odoo is connected, pull Odoo payments via XML-RPC
// 4. Match by reference_id / tracking_key
// 5. Compare amounts, detect discrepancies
// 6. Store results in reconciliations + reconciliation_entries
// ══════════════════════════════════════════════════════════

async function reconcileFintocOdoo(companyId: number, days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();

  // 1. Get all payments from Supabase
  const { data: payments } = await query("payments", {
    match: { company_id: companyId },
    order: { column: "created_at" },
  });
  const allPayments = (payments || []).filter(
    (p: Record<string, unknown>) => new Date(p.created_at as string) >= cutoff
  );

  // 2. Check if Odoo integration exists and get config
  let odooConfig: Record<string, string> | null = null;
  try {
    const { data: integration } = await query("integrations", {
      match: { company_id: companyId, provider: "odoo" },
      single: true,
    });
    if (integration?.is_connected && integration.config) {
      odooConfig = integration.config as Record<string, string>;
    }
  } catch { /* integrations table might not exist */ }

  // 3. If Odoo is connected, pull Odoo payments via XML-RPC
  let odooPayments: Record<string, unknown>[] = [];
  if (odooConfig) {
    odooPayments = await fetchOdooPayments(odooConfig, days);
  }

  // 4. Build index of Odoo payments by reference for matching
  const odooByRef = new Map<string, Record<string, unknown>>();
  for (const op of odooPayments) {
    const ref = (op.ref as string) || (op.name as string) || "";
    if (ref) odooByRef.set(ref.toLowerCase(), op);
  }

  // 5. Match payments
  const entries: Array<{
    payment_ref: string;
    amount_erp: number;
    amount_bank: number;
    difference: number;
    status: "matched" | "unmatched" | "partial";
    cfdi_uuid: string | null;
    sat_status: string | null;
    notes: string;
  }> = [];

  let matched = 0;
  let unmatched = 0;
  let partial = 0;
  let totalDiscrepancy = 0;
  const matchedOdooRefs = new Set<string>();

  for (const payment of allPayments) {
    const ref = ((payment.reference_id as string) || "").toLowerCase();
    const amount = Number(payment.amount) || 0;
    const cfdiUuid = (payment.cfdi_uuid as string) || null;
    const satStatus = (payment.sat_status as string) || null;

    // Try to match with Odoo
    const odooMatch = ref ? odooByRef.get(ref) : null;

    if (odooMatch) {
      matchedOdooRefs.add(ref);
      const odooAmount = Number(odooMatch.amount) || 0;
      const diff = Math.abs(amount - odooAmount);
      const threshold = Math.max(amount, odooAmount) * 0.001; // 0.1% tolerance

      if (diff <= threshold) {
        entries.push({
          payment_ref: (payment.reference_id as string) || `PAY-${payment.id}`,
          amount_erp: odooAmount,
          amount_bank: amount,
          difference: 0,
          status: "matched",
          cfdi_uuid: cfdiUuid,
          sat_status: satStatus,
          notes: `Matched with Odoo ref: ${odooMatch.name || ref}`,
        });
        matched++;
      } else {
        entries.push({
          payment_ref: (payment.reference_id as string) || `PAY-${payment.id}`,
          amount_erp: odooAmount,
          amount_bank: amount,
          difference: amount - odooAmount,
          status: "partial",
          cfdi_uuid: cfdiUuid,
          sat_status: satStatus,
          notes: `Amount mismatch: bank=${amount}, ERP=${odooAmount}, diff=${diff.toFixed(2)}`,
        });
        partial++;
        totalDiscrepancy += diff;
      }
    } else if (!odooConfig) {
      // No Odoo connected — self-reconcile: mark confirmed payments as matched
      if (payment.status === "confirmed") {
        entries.push({
          payment_ref: (payment.reference_id as string) || `PAY-${payment.id}`,
          amount_erp: amount,
          amount_bank: amount,
          difference: 0,
          status: "matched",
          cfdi_uuid: cfdiUuid,
          sat_status: satStatus,
          notes: "Self-reconciled (no Odoo connected)",
        });
        matched++;
      } else {
        entries.push({
          payment_ref: (payment.reference_id as string) || `PAY-${payment.id}`,
          amount_erp: 0,
          amount_bank: amount,
          difference: amount,
          status: "unmatched",
          cfdi_uuid: cfdiUuid,
          sat_status: satStatus,
          notes: `Unconfirmed payment (status: ${payment.status})`,
        });
        unmatched++;
        totalDiscrepancy += amount;
      }
    } else {
      // Odoo connected but no match found
      entries.push({
        payment_ref: (payment.reference_id as string) || `PAY-${payment.id}`,
        amount_erp: 0,
        amount_bank: amount,
        difference: amount,
        status: "unmatched",
        cfdi_uuid: cfdiUuid,
        sat_status: satStatus,
        notes: "No matching Odoo payment found",
      });
      unmatched++;
      totalDiscrepancy += amount;
    }
  }

  // Odoo payments not in our DB
  for (const op of odooPayments) {
    const ref = ((op.ref as string) || (op.name as string) || "").toLowerCase();
    if (ref && !matchedOdooRefs.has(ref)) {
      const odooAmount = Number(op.amount) || 0;
      entries.push({
        payment_ref: (op.name as string) || ref,
        amount_erp: odooAmount,
        amount_bank: 0,
        difference: -odooAmount,
        status: "unmatched",
        cfdi_uuid: (op.cfdi_uuid as string) || null,
        sat_status: (op.sat_status as string) || null,
        notes: "Odoo payment not found in bank records",
      });
      unmatched++;
      totalDiscrepancy += odooAmount;
    }
  }

  // 6. Store reconciliation run
  const totalTransactions = matched + unmatched + partial;
  const amountMatched = entries
    .filter((e) => e.status === "matched")
    .reduce((s, e) => s + e.amount_bank, 0);

  const { data: reconData } = await insert("reconciliations", {
    company_id: companyId,
    type: "fintoc-odoo",
    status: unmatched === 0 && partial === 0 ? "matched" : "unmatched",
    total_transactions: totalTransactions,
    matched,
    unmatched,
    amount_matched: amountMatched,
    period_days: days,
    partial,
    total_discrepancy: totalDiscrepancy,
  });

  const reconId = reconData?.[0]?.id;

  // Store individual entries
  if (reconId && entries.length > 0) {
    try {
      await insert(
        "reconciliation_entries",
        entries.map((e) => ({
          company_id: companyId,
          reconciliation_id: reconId,
          source: "fintoc-odoo",
          payment_ref: e.payment_ref,
          amount_erp: e.amount_erp,
          amount_bank: e.amount_bank,
          difference: e.difference,
          status: e.status,
          cfdi_uuid: e.cfdi_uuid,
          sat_status: e.sat_status,
          notes: e.notes,
          matched_at: e.status === "matched" ? new Date().toISOString() : null,
        }))
      );
    } catch {
      // reconciliation_entries table might not exist yet — that's OK
    }
  }

  return NextResponse.json({
    id: reconId,
    period_days: days,
    total_transactions: totalTransactions,
    matched,
    unmatched,
    partial,
    total_discrepancy: totalDiscrepancy,
    amount_matched: amountMatched,
    summary: { matched, unmatched, partial },
    entries: entries.map((e) => ({
      odoo_payment: e.payment_ref,
      amount_odoo: e.amount_erp,
      amount_fintoc: e.amount_bank,
      difference: e.difference,
      status: e.status,
      cfdi_uuid: e.cfdi_uuid || "-",
      sat_status: e.sat_status || "-",
      notes: e.notes,
    })),
  });
}

// ══════════════════════════════════════════════════════════
// SAT Reconciliation Engine
// ══════════════════════════════════════════════════════════
//
// Validates all CFDI documents for the company:
// 1. Fetch invoices + payments that have CFDI UUIDs
// 2. Validate each against SAT SOAP service
// 3. Flag: missing complement, cancelled, non-vigente
// ══════════════════════════════════════════════════════════

async function reconcileSat(companyId: number, days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // Fetch CFDI documents
  const { data: cfdis } = await query("cfdi_documents", {
    match: { company_id: companyId },
    order: { column: "fecha_emision" },
  });
  const allCfdis = (cfdis || []).filter(
    (c: Record<string, unknown>) => new Date(c.fecha_emision as string) >= cutoff
  );

  // Fetch invoices with CFDI UUIDs
  const { data: invoices } = await query("invoices", {
    match: { company_id: companyId },
    order: { column: "created_at" },
  });
  const recentInvoices = (invoices || []).filter(
    (i: Record<string, unknown>) => new Date(i.created_at as string) >= cutoff && i.cfdi_uuid
  );

  // Get company RFC for SAT validation
  let companyRfc = "";
  try {
    const { data: integration } = await query("integrations", {
      match: { company_id: companyId, provider: "sat" },
      single: true,
    });
    if (integration?.config) {
      companyRfc = (integration.config as Record<string, string>).rfcEmisor || "";
    }
  } catch { /* table might not exist */ }

  if (!companyRfc) {
    const { data: company } = await query("companies", {
      match: { id: companyId },
      single: true,
    });
    companyRfc = (company?.rfc as string) || "";
  }

  const entries: Array<{
    payment_ref: string;
    amount_erp: number;
    amount_bank: number;
    difference: number;
    status: "matched" | "unmatched" | "partial";
    cfdi_uuid: string;
    sat_status: string;
    notes: string;
  }> = [];

  let matched = 0;
  let unmatched = 0;
  let partial = 0;
  let totalDiscrepancy = 0;

  // Validate CFDI documents
  for (const cfdi of allCfdis) {
    const uuid = cfdi.uuid as string;
    const satStatus = (cfdi.sat_status as string) || "Desconocido";
    const total = Number(cfdi.total) || 0;

    // Try real SAT validation if we have RFC
    let validatedStatus = satStatus;
    if (companyRfc && uuid) {
      validatedStatus = await validateCfdiWithSat(
        uuid,
        (cfdi.rfc_emisor as string) || companyRfc,
        (cfdi.rfc_receptor as string) || companyRfc,
        String(total)
      );

      // Update the CFDI record if status changed
      if (validatedStatus !== satStatus) {
        await update("cfdi_documents", { sat_status: validatedStatus }, {
          id: cfdi.id as number,
          company_id: companyId,
        });
      }
    }

    if (validatedStatus === "Vigente") {
      entries.push({
        payment_ref: uuid,
        amount_erp: total,
        amount_bank: total,
        difference: 0,
        status: "matched",
        cfdi_uuid: uuid,
        sat_status: validatedStatus,
        notes: "CFDI vigente en SAT",
      });
      matched++;
    } else if (validatedStatus === "Cancelado") {
      entries.push({
        payment_ref: uuid,
        amount_erp: total,
        amount_bank: 0,
        difference: total,
        status: "unmatched",
        cfdi_uuid: uuid,
        sat_status: validatedStatus,
        notes: "CFDI cancelado en SAT",
      });
      unmatched++;
      totalDiscrepancy += total;
    } else {
      entries.push({
        payment_ref: uuid,
        amount_erp: total,
        amount_bank: total,
        difference: 0,
        status: "partial",
        cfdi_uuid: uuid,
        sat_status: validatedStatus,
        notes: `Estado SAT: ${validatedStatus}`,
      });
      partial++;
    }
  }

  // Check invoices that should have CFDI but don't
  for (const inv of recentInvoices) {
    const uuid = inv.cfdi_uuid as string;
    // Skip if we already validated this UUID from cfdi_documents
    if (allCfdis.some((c: Record<string, unknown>) => c.uuid === uuid)) continue;

    const total = Number(inv.amount_total) || 0;

    if (!uuid || uuid === "") {
      entries.push({
        payment_ref: `INV-${inv.id}`,
        amount_erp: total,
        amount_bank: 0,
        difference: total,
        status: "unmatched",
        cfdi_uuid: "-",
        sat_status: "Sin complemento",
        notes: "Factura sin UUID de CFDI",
      });
      unmatched++;
      totalDiscrepancy += total;
    }
  }

  // Store reconciliation
  const totalTransactions = matched + unmatched + partial;
  const amountMatched = entries
    .filter((e) => e.status === "matched")
    .reduce((s, e) => s + e.amount_erp, 0);

  const { data: reconData } = await insert("reconciliations", {
    company_id: companyId,
    type: "sat",
    status: unmatched === 0 && partial === 0 ? "matched" : "unmatched",
    total_transactions: totalTransactions,
    matched,
    unmatched,
    amount_matched: amountMatched,
    period_days: days,
    partial,
    total_discrepancy: totalDiscrepancy,
  });

  const reconId = reconData?.[0]?.id;

  // Store individual entries
  if (reconId && entries.length > 0) {
    try {
      await insert(
        "reconciliation_entries",
        entries.map((e) => ({
          company_id: companyId,
          reconciliation_id: reconId,
          source: "sat",
          payment_ref: e.payment_ref,
          amount_erp: e.amount_erp,
          amount_bank: e.amount_bank,
          difference: e.difference,
          status: e.status,
          cfdi_uuid: e.cfdi_uuid,
          sat_status: e.sat_status,
          notes: e.notes,
          matched_at: e.status === "matched" ? new Date().toISOString() : null,
        }))
      );
    } catch {
      // reconciliation_entries table might not exist
    }
  }

  return NextResponse.json({
    id: reconId,
    period_days: days,
    total_transactions: totalTransactions,
    total: totalTransactions,
    issues: unmatched + partial,
    ok: matched,
    matched,
    unmatched,
    partial,
    total_discrepancy: totalDiscrepancy,
    amount_matched: amountMatched,
    summary: { matched, unmatched, partial },
    entries: entries.map((e) => ({
      odoo_payment: e.payment_ref,
      amount_odoo: e.amount_erp,
      amount_fintoc: e.amount_bank,
      difference: e.difference,
      status: e.status,
      cfdi_uuid: e.cfdi_uuid,
      sat_status: e.sat_status,
      notes: e.notes,
    })),
  });
}

// ══════════════════════════════════════════════════════════
// SAT SOAP CFDI Validation
// ══════════════════════════════════════════════════════════

async function validateCfdiWithSat(
  uuid: string,
  rfcEmisor: string,
  rfcReceptor: string,
  total: string
): Promise<string> {
  try {
    const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soap:Body>
    <tem:Consulta>
      <tem:expresionImpresa><![CDATA[?re=${rfcEmisor}&rr=${rfcReceptor}&tt=${total}&id=${uuid}]]></tem:expresionImpresa>
    </tem:Consulta>
  </soap:Body>
</soap:Envelope>`;

    const res = await fetch(
      "https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc",
      {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: "http://tempuri.org/IConsultaCFDIService/Consulta",
        },
        body: soapEnvelope,
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!res.ok) return "Error";

    const text = await res.text();

    // Parse SAT response
    if (text.includes("Vigente")) return "Vigente";
    if (text.includes("Cancelado")) return "Cancelado";
    if (text.includes("No Encontrado")) return "No Encontrado";

    return "Desconocido";
  } catch {
    // SAT service unavailable — don't fail the reconciliation
    return "Sin verificar";
  }
}

// ══════════════════════════════════════════════════════════
// Odoo JSON-RPC Helpers (modern standard)
// ══════════════════════════════════════════════════════════

interface OdooJsonRpcResult {
  jsonrpc: string;
  result?: unknown;
  error?: { message: string; data?: { message?: string } };
}

async function odooJsonRpc(
  url: string, service: string, method: string, args: unknown[], timeout = 15000,
): Promise<OdooJsonRpcResult> {
  const res = await fetch(`${url.replace(/\/$/, "")}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: Date.now(), params: { service, method, args } }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchOdooPayments(
  config: Record<string, string>,
  days: number,
): Promise<Record<string, unknown>[]> {
  const { url, database, user, password } = config;
  if (!url || !database || !user || !password) return [];

  try {
    // Authenticate via JSON-RPC
    const authResult = await odooJsonRpc(url, "common", "authenticate", [database, user, password, {}]);
    const uid = authResult.result as number | false;
    if (!uid) return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Fetch payments via JSON-RPC
    const result = await odooJsonRpc(url, "object", "execute_kw", [
      database, uid, password,
      "account.payment", "search_read",
      [[["date", ">=", cutoffStr]]],
      { fields: ["name", "amount", "date", "ref", "state", "payment_type", "partner_id"], limit: 2000 },
    ], 30000);

    if (result.error) return [];
    return (result.result as Record<string, unknown>[]) || [];
  } catch {
    return [];
  }
}
