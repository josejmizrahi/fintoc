import { NextRequest, NextResponse } from "next/server";
import { hasDB, query, insert, update } from "@/lib/db";
import { getCompanyId } from "@/lib/auth-helpers";
import { createOdooClient, m2oId, m2oName } from "@/lib/odoo";
import { fintocGet } from "@/lib/fintoc";
import { validateCfdiAgainstSat } from "@/lib/sat";
import { createSyntageClient } from "@/lib/syntage";

// ── Types ──

/** Diff summary per entity type */
interface DiffCounts {
  new: number;
  updated: number;
  unchanged: number;
}

/** Full diff across all entity types */
interface SyncDiff {
  [entity: string]: DiffCounts;
}

// ── Sync log helpers ──

async function createSyncLog(companyId: number, provider: string, syncType: string, totalItems = 0) {
  const { data } = await insert("sync_logs", {
    company_id: companyId,
    provider,
    sync_type: syncType,
    status: "running",
    total_items: totalItems,
    processed_items: 0,
    started_at: new Date().toISOString(),
  });
  return data?.[0]?.id as number | undefined;
}

async function updateSyncLog(logId: number | undefined, fields: Record<string, unknown>) {
  if (!logId) return;
  await update("sync_logs", fields, { id: logId }).catch(() => {});
}

async function completeSyncLog(logId: number | undefined, status: string, processed: number, details: Record<string, unknown>, errorMessage?: string) {
  if (!logId) return;
  await update("sync_logs", {
    status,
    processed_items: processed,
    details,
    error_message: errorMessage || null,
    completed_at: new Date().toISOString(),
  }, { id: logId }).catch(() => {});
}

/** Build a human-readable summary from a diff */
function diffSummary(diff: SyncDiff): string {
  const labels: Record<string, string> = {
    customers: "clientes", vendors: "proveedores", invoices: "facturas",
    payments: "pagos", expenses: "gastos", purchase_orders: "OC",
    movements: "movimientos", bank_movements: "mov. bancarios",
  };
  const parts: string[] = [];
  for (const [entity, counts] of Object.entries(diff)) {
    const label = labels[entity] || entity;
    const items: string[] = [];
    if (counts.new > 0) items.push(`+${counts.new}`);
    if (counts.updated > 0) items.push(`~${counts.updated}`);
    if (items.length > 0) parts.push(`${label}: ${items.join(", ")}`);
  }
  return parts.length > 0 ? parts.join(" | ") : "Sin cambios";
}

// ── GET /api/sync — returns latest sync status per provider ──

export async function GET(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  if (!hasDB()) return NextResponse.json({ detail: "DB no configurada" }, { status: 500 });

  const { data: logs } = await query("sync_logs", {
    match: { company_id: companyId },
    order: { column: "started_at", ascending: false },
    limit: 10,
  });

  return NextResponse.json({ logs: logs || [] });
}

// ── POST /api/sync — trigger a sync for a provider (or all) ──

export async function POST(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  if (!hasDB()) return NextResponse.json({ detail: "DB no configurada" }, { status: 500 });

  const body = await req.json();
  const { provider } = body as { provider?: string };

  if (!provider || !["odoo", "fintoc", "sat", "all"].includes(provider)) {
    return NextResponse.json({ detail: "Proveedor invalido" }, { status: 400 });
  }

  // Sync all connected providers in parallel
  if (provider === "all") {
    return syncAllProviders(companyId);
  }

  const { data: integration } = await query("integrations", {
    match: { company_id: companyId, provider },
    single: true,
  });

  if (!integration?.config) {
    return NextResponse.json({
      success: false,
      message: `No hay configuracion guardada para ${provider}. Configura primero en Configuracion.`,
    }, { status: 400 });
  }

  const config = integration.config as Record<string, string>;

  if (provider === "odoo") return syncOdoo(companyId, config);
  if (provider === "fintoc") return syncFintoc(companyId, config);
  if (provider === "sat") return syncSat(companyId, config);

  return NextResponse.json({ detail: "Proveedor invalido" }, { status: 400 });
}

async function syncAllProviders(companyId: number) {
  const { data: integrations } = await query("integrations", {
    match: { company_id: companyId },
  });

  const results: Record<string, { success: boolean; message: string }> = {};
  const promises: Promise<void>[] = [];

  for (const integration of (integrations || [])) {
    if (!integration.is_connected || !integration.config) continue;
    const p = integration.provider as string;
    const config = integration.config as Record<string, string>;

    const run = async () => {
      try {
        if (p === "odoo") {
          const res = await syncOdoo(companyId, config);
          const body = await res.json();
          results[p] = { success: body.success !== false, message: body.message || "OK" };
        } else if (p === "fintoc") {
          const res = await syncFintoc(companyId, config);
          const body = await res.json();
          results[p] = { success: body.success !== false, message: body.message || "OK" };
        } else if (p === "sat") {
          const res = await syncSat(companyId, config);
          const body = await res.json();
          results[p] = { success: body.success !== false, message: body.message || "OK" };
        }
      } catch (err) {
        results[p] = { success: false, message: err instanceof Error ? err.message : "Error desconocido" };
      }
    };
    promises.push(run());
  }

  await Promise.allSettled(promises);

  const allSuccess = Object.values(results).every((r) => r.success);
  const synced = Object.keys(results);

  return NextResponse.json({
    success: allSuccess,
    message: synced.length > 0
      ? `Sincronizacion ${allSuccess ? "completada" : "parcial"}: ${synced.join(", ")}`
      : "No hay integraciones conectadas",
    results,
  });
}

// ════════════════════════════════════════════════════════════════
// ODOO SYNC — Two-phase: fetch+diff → merge
// ════════════════════════════════════════════════════════════════

async function syncOdoo(companyId: number, config: Record<string, string>) {
  const { url, database, user, password } = config;
  if (!url || !database || !user || !password) {
    return NextResponse.json({ success: false, message: "Configuracion de Odoo incompleta" });
  }

  const logId = await createSyncLog(companyId, "odoo", "full");
  const errors: string[] = [];
  const diff: SyncDiff = {};

  try {
    const client = createOdooClient(config);
    await client.connect();

    // ── Phase 1: FETCH — pull all remote data ──
    await updateSyncLog(logId, { details: { phase: "fetching" } });

    // Helper: Fetch bank accounts (CLABE + bank name) for partners
    async function fetchPartnerBankInfo(partnerIds: number[]): Promise<Map<number, { clabe: string; bankName: string }>> {
      const bankMap = new Map<number, { clabe: string; bankName: string }>();
      if (partnerIds.length === 0) return bankMap;
      try {
        const banks = await client.searchRead("res.partner.bank",
          [["partner_id", "in", partnerIds]],
          ["id", "acc_number", "partner_id", "bank_id", "l10n_mx_edi_clabe"]);
        for (const b of banks) {
          const partnerId = m2oId(b.partner_id);
          const clabe = (b.l10n_mx_edi_clabe as string) || (b.acc_number as string) || "";
          const bankName = m2oName(b.bank_id);
          if (partnerId && clabe && !bankMap.has(partnerId)) {
            bankMap.set(partnerId, { clabe, bankName });
          }
        }
      } catch { /* res.partner.bank may not be accessible */ }
      return bankMap;
    }

    // Cache Odoo IDs (non-critical)
    try {
      const journalId = await client.findBankJournalId();
      const currencyId = await client.findCurrencyId("MXN");
      if (journalId) {
        await upsertCache(companyId, "bank_journal_id", journalId);
        const methodLineId = await client.findPaymentMethodLineId(journalId);
        if (methodLineId) await upsertCache(companyId, "transfer_method_line_id", methodLineId);
      }
      if (currencyId) await upsertCache(companyId, "mxn_currency_id", currencyId);
    } catch { /* non-critical */ }

    // Fetch all remote data in parallel where possible
    const [remoteCustomers, remoteVendors, remoteInvoices, remotePayments] = await Promise.all([
      client.fetchAll("res.partner",
        [["customer_rank", ">", 0]],
        ["id", "name", "vat", "email", "phone", "bank_ids",
         "customer_rank", "l10n_mx_edi_fiscal_regime", "property_payment_term_id"]).catch(e => { errors.push(`Clientes: ${e instanceof Error ? e.message : "error"}`); return []; }),
      client.fetchAll("res.partner",
        [["supplier_rank", ">", 0]],
        ["id", "name", "vat", "email", "phone", "bank_ids",
         "supplier_rank", "l10n_mx_edi_fiscal_regime", "property_payment_term_id"]).catch(e => { errors.push(`Proveedores: ${e instanceof Error ? e.message : "error"}`); return []; }),
      client.fetchAll("account.move",
        [["move_type", "in", ["out_invoice", "in_invoice", "out_refund", "in_refund"]]],
        ["id", "name", "partner_id", "move_type", "state", "payment_state",
         "amount_total", "amount_residual", "amount_tax",
         "invoice_date", "invoice_date_due", "currency_id",
         "l10n_mx_edi_cfdi_uuid", "l10n_mx_edi_payment_policy",
         "l10n_mx_edi_usage", "l10n_mx_edi_payment_method_id",
         "invoice_line_ids"]).catch(e => { errors.push(`Facturas: ${e instanceof Error ? e.message : "error"}`); return []; }),
      client.fetchAll("account.payment",
        [["state", "in", ["posted", "sent", "reconciled"]]],
        ["id", "name", "partner_id", "amount", "payment_type", "partner_type",
         "date", "ref", "currency_id", "state", "journal_id",
         "reconciled_invoice_ids"]).catch(e => { errors.push(`Pagos: ${e instanceof Error ? e.message : "error"}`); return []; }),
    ]);

    let remoteExpenses: Record<string, unknown>[] = [];
    try {
      remoteExpenses = await client.fetchAll("hr.expense",
        [["state", "in", ["approved", "done", "reported"]]],
        ["id", "name", "employee_id", "total_amount", "currency_id", "date",
         "state", "description", "product_id", "payment_mode", "reference", "sheet_id"]);
    } catch { /* hr.expense module may not be installed */ }

    let remotePurchaseOrders: Record<string, unknown>[] = [];
    try {
      remotePurchaseOrders = await client.fetchAll("purchase.order",
        [["state", "in", ["purchase", "done"]]],
        ["id", "name", "partner_id", "state", "amount_total", "amount_tax",
         "currency_id", "date_order", "date_planned", "invoice_status", "invoice_count", "notes"]);
    } catch { /* purchase module may not be installed */ }

    const totalRemote = remoteCustomers.length + remoteVendors.length + remoteInvoices.length
      + remotePayments.length + remoteExpenses.length + remotePurchaseOrders.length;

    // Fetch bank info for customers and vendors
    const customerBankIds = remoteCustomers.filter(c => Array.isArray(c.bank_ids) && (c.bank_ids as number[]).length > 0).map(c => c.id as number);
    const vendorBankIds = remoteVendors.filter(v => Array.isArray(v.bank_ids) && (v.bank_ids as number[]).length > 0).map(v => v.id as number);
    const [customerBanks, vendorBanks] = await Promise.all([
      fetchPartnerBankInfo(customerBankIds),
      fetchPartnerBankInfo(vendorBankIds),
    ]);

    // Batch fetch partner RFCs for invoices and payments
    const invoicePartnerIds = [...new Set(remoteInvoices.map(inv => m2oId(inv.partner_id)).filter((id): id is number => id !== null))];
    const payPartnerIds = [...new Set(remotePayments.map(p => m2oId(p.partner_id)).filter((id): id is number => id !== null))];
    const allPartnerIds = [...new Set([...invoicePartnerIds, ...payPartnerIds])];
    const rfcMap = new Map<number, string>();
    if (allPartnerIds.length > 0) {
      try {
        const partners = await client.searchRead("res.partner", [["id", "in", allPartnerIds]], ["id", "vat", "name"]);
        for (const p of partners) { if (p.vat) rfcMap.set(p.id as number, p.vat as string); }
      } catch { /* continue without RFC */ }
    }

    // ── Phase 2: DIFF — compare remote vs local, count changes ──
    await updateSyncLog(logId, { total_items: totalRemote, details: { phase: "reviewing", total_remote: totalRemote } });

    // Diff customers
    diff.customers = { new: 0, updated: 0, unchanged: 0 };
    for (const c of remoteCustomers) {
      if (!c.name) continue;
      const odooId = c.id as number;
      const rfc = (c.vat as string) || null;
      const { data: existing } = await query("customers", { match: { company_id: companyId, odoo_id: odooId }, single: true }).catch(() => ({ data: null }));
      if (!existing) {
        if (rfc) {
          const { data: byRfc } = await query("customers", { match: { company_id: companyId, rfc }, single: true }).catch(() => ({ data: null }));
          if (byRfc) { diff.customers.updated++; } else { diff.customers.new++; }
        } else { diff.customers.new++; }
      } else { diff.customers.updated++; }
    }

    // Diff vendors
    diff.vendors = { new: 0, updated: 0, unchanged: 0 };
    for (const v of remoteVendors) {
      if (!v.name) continue;
      const odooId = v.id as number;
      const rfc = (v.vat as string) || null;
      const { data: existing } = await query("vendors", { match: { company_id: companyId, odoo_id: odooId }, single: true }).catch(() => ({ data: null }));
      if (!existing) {
        if (rfc) {
          const { data: byRfc } = await query("vendors", { match: { company_id: companyId, rfc }, single: true }).catch(() => ({ data: null }));
          if (byRfc) { diff.vendors.updated++; } else { diff.vendors.new++; }
        } else { diff.vendors.new++; }
      } else { diff.vendors.updated++; }
    }

    // Diff invoices
    diff.invoices = { new: 0, updated: 0, unchanged: 0 };
    for (const inv of remoteInvoices) {
      const odooId = inv.id as number;
      const cfdiUuid = (inv.l10n_mx_edi_cfdi_uuid as string) || null;
      const odooRef = (inv.name as string) || `ODOO-${inv.id}`;
      let existing = null;
      const { data: byOdooId } = await query("invoices", { match: { company_id: companyId, odoo_id: odooId }, single: true }).catch(() => ({ data: null }));
      existing = byOdooId;
      if (!existing && cfdiUuid) {
        const q = await query("invoices", { match: { company_id: companyId, cfdi_uuid: cfdiUuid }, single: true }).catch(() => ({ data: null }));
        existing = q.data;
      }
      if (!existing) {
        const q = await query("invoices", { match: { company_id: companyId, name: odooRef }, single: true }).catch(() => ({ data: null }));
        existing = q.data;
      }
      if (!existing) { diff.invoices.new++; } else { diff.invoices.updated++; }
    }

    // Diff payments
    diff.payments = { new: 0, updated: 0, unchanged: 0 };
    for (const p of remotePayments) {
      const odooId = p.id as number;
      const { data: existing } = await query("payments", { match: { company_id: companyId, odoo_id: odooId }, single: true }).catch(() => ({ data: null }));
      if (!existing) { diff.payments.new++; } else { diff.payments.updated++; }
    }

    // Diff expenses
    if (remoteExpenses.length > 0) {
      diff.expenses = { new: 0, updated: 0, unchanged: 0 };
      for (const exp of remoteExpenses) {
        const odooId = exp.id as number;
        const { data: existing } = await query("expenses", { match: { company_id: companyId, odoo_id: odooId }, single: true }).catch(() => ({ data: null }));
        if (!existing) { diff.expenses.new++; } else { diff.expenses.updated++; }
      }
    }

    // Diff purchase orders
    if (remotePurchaseOrders.length > 0) {
      diff.purchase_orders = { new: 0, updated: 0, unchanged: 0 };
      for (const po of remotePurchaseOrders) {
        const odooId = po.id as number;
        const { data: existing } = await query("odoo_purchase_orders", { match: { company_id: companyId, odoo_id: odooId }, single: true }).catch(() => ({ data: null }));
        if (!existing) { diff.purchase_orders.new++; } else { diff.purchase_orders.updated++; }
      }
    }

    // Update log with diff summary so frontend can show it
    const summary = diffSummary(diff);
    await updateSyncLog(logId, {
      details: { phase: "reviewing", diff, summary, total_remote: totalRemote },
    });

    // ── Phase 3: MERGE — apply all changes ──
    await updateSyncLog(logId, {
      details: { phase: "merging", diff, summary, total_remote: totalRemote },
    });

    let totalProcessed = 0;

    // Merge customers
    for (const c of remoteCustomers) {
      if (!c.name) continue;
      const odooId = c.id as number;
      const rfc = (c.vat as string) || null;
      const bankInfo = customerBanks.get(odooId);
      const customerData: Record<string, unknown> = {
        name: c.name, rfc, email: (c.email as string) || null,
        phone: (c.phone as string) || null,
        customer_rank: (c.customer_rank as number) || 0,
        regimen_fiscal: (c.l10n_mx_edi_fiscal_regime as string) || null,
        payment_term: m2oName(c.property_payment_term_id) || null,
        odoo_id: odooId, source: "odoo",
        ...(bankInfo ? { clabe: bankInfo.clabe } : {}),
      };
      const { data: existing } = await query("customers", { match: { company_id: companyId, odoo_id: odooId }, single: true }).catch(() => ({ data: null }));
      if (!existing) {
        const { data: byRfc } = rfc ? await query("customers", { match: { company_id: companyId, rfc }, single: true }) : { data: null };
        if (byRfc) { await update("customers", customerData, { id: (byRfc as Record<string, unknown>).id }); }
        else { await insert("customers", { company_id: companyId, ...customerData }); }
      } else { await update("customers", customerData, { id: (existing as Record<string, unknown>).id }); }
      totalProcessed++;
    }

    // Merge vendors
    for (const v of remoteVendors) {
      if (!v.name) continue;
      const odooId = v.id as number;
      const rfc = (v.vat as string) || null;
      const bankInfo = vendorBanks.get(odooId);
      const vendorData: Record<string, unknown> = {
        name: v.name, rfc, email: (v.email as string) || null,
        phone: (v.phone as string) || null,
        supplier_rank: (v.supplier_rank as number) || 0,
        regimen_fiscal: (v.l10n_mx_edi_fiscal_regime as string) || null,
        payment_term: m2oName(v.property_payment_term_id) || null,
        odoo_id: odooId, source: "odoo",
        ...(bankInfo ? { clabe: bankInfo.clabe, bank_name: bankInfo.bankName } : {}),
      };
      const { data: existing } = await query("vendors", { match: { company_id: companyId, odoo_id: odooId }, single: true }).catch(() => ({ data: null }));
      if (!existing) {
        const { data: byRfc } = rfc ? await query("vendors", { match: { company_id: companyId, rfc }, single: true }) : { data: null };
        if (byRfc) { await update("vendors", vendorData, { id: (byRfc as Record<string, unknown>).id }); }
        else { await insert("vendors", { company_id: companyId, ...vendorData }); }
      } else { await update("vendors", vendorData, { id: (existing as Record<string, unknown>).id }); }
      totalProcessed++;
    }

    // Merge invoices
    for (const inv of remoteInvoices) {
      const odooId = inv.id as number;
      const cfdiUuid = (inv.l10n_mx_edi_cfdi_uuid as string) || null;
      const odooRef = (inv.name as string) || `ODOO-${inv.id}`;
      const partnerName = m2oName(inv.partner_id);
      const partnerId = m2oId(inv.partner_id);
      const partnerRfc = partnerId ? (rfcMap.get(partnerId) || null) : null;
      const moveType = inv.move_type as string;
      const currencyName = m2oName(inv.currency_id) || "MXN";
      const paymentPolicy = (inv.l10n_mx_edi_payment_policy as string) || null;
      const usoCfdi = (inv.l10n_mx_edi_usage as string) || null;
      const paymentMethod = m2oName(inv.l10n_mx_edi_payment_method_id) || null;
      const lineIds = Array.isArray(inv.invoice_line_ids) ? (inv.invoice_line_ids as number[]).length : 0;
      const isPayable = moveType === "in_invoice" || moveType === "in_refund";

      const invoiceData: Record<string, unknown> = {
        company_id: companyId, name: odooRef, odoo_id: odooId, source: "odoo",
        type: isPayable ? "payable" : "receivable", move_type: moveType,
        partner_name: partnerName, partner_rfc: partnerRfc,
        amount_total: Number(inv.amount_total) || 0,
        amount_residual: Number(inv.amount_residual) || 0,
        amount_tax: Number(inv.amount_tax) || 0,
        date_invoice: (inv.invoice_date as string) || null,
        date_due: (inv.invoice_date_due as string) || null,
        status: inv.state === "posted" ? "open" : inv.state === "cancel" ? "cancelled" : "draft",
        payment_state: (inv.payment_state as string) || null,
        cfdi_uuid: cfdiUuid, odoo_cfdi_uuid: cfdiUuid,
        payment_policy: paymentPolicy === "ppd" || paymentPolicy === "PPD" ? "PPD" : paymentPolicy === "pue" || paymentPolicy === "PUE" ? "PUE" : null,
        odoo_usage: usoCfdi, odoo_payment_method: paymentMethod,
        currency: currencyName, invoice_line_count: lineIds,
      };

      let existing = null;
      const { data: byOdooId } = await query("invoices", { match: { company_id: companyId, odoo_id: odooId }, single: true }).catch(() => ({ data: null }));
      existing = byOdooId;
      if (!existing && cfdiUuid) {
        const q = await query("invoices", { match: { company_id: companyId, cfdi_uuid: cfdiUuid }, single: true }).catch(() => ({ data: null }));
        existing = q.data;
      }
      if (!existing) {
        const q = await query("invoices", { match: { company_id: companyId, name: odooRef }, single: true }).catch(() => ({ data: null }));
        existing = q.data;
      }

      if (!existing) {
        await insert("invoices", invoiceData);
      } else {
        const existingRec = existing as Record<string, unknown>;
        const updateData: Record<string, unknown> = { ...invoiceData };
        delete updateData.company_id;
        if (!cfdiUuid && existingRec.cfdi_uuid) delete updateData.cfdi_uuid;
        await update("invoices", updateData, { id: existingRec.id });
      }
      totalProcessed++;
    }

    // Merge payments
    for (const p of remotePayments) {
      const odooId = p.id as number;
      const ref = (p.ref as string) || (p.name as string) || `ODOO-PAY-${p.id}`;
      const partnerName = m2oName(p.partner_id);
      const partnerId = m2oId(p.partner_id);
      const partnerRfc = partnerId ? (rfcMap.get(partnerId) || null) : null;
      const currencyName = m2oName(p.currency_id) || "MXN";
      const reconciled = Array.isArray(p.reconciled_invoice_ids) ? p.reconciled_invoice_ids : [];

      const paymentData: Record<string, unknown> = {
        company_id: companyId,
        direction: p.payment_type === "inbound" ? "inbound" : "outbound",
        status: "confirmed", amount: Math.abs(Number(p.amount) || 0),
        currency: currencyName, reference_id: ref,
        partner_name: partnerName, partner_rfc: partnerRfc,
        executed_at: (p.date as string) || new Date().toISOString(),
        odoo_id: odooId, odoo_state: (p.state as string) || null,
        reconciled_invoice_ids: reconciled.length > 0 ? JSON.stringify(reconciled) : null,
        source: "odoo",
      };

      const { data: existing } = await query("payments", { match: { company_id: companyId, odoo_id: odooId }, single: true }).catch(() => ({ data: null }));
      if (!existing) {
        await insert("payments", paymentData);
      } else {
        const { company_id: _, ...updateFields } = paymentData;
        await update("payments", updateFields, { id: (existing as Record<string, unknown>).id });
      }
      totalProcessed++;
    }

    // Merge expenses
    for (const exp of remoteExpenses) {
      const odooId = exp.id as number;
      const employeeName = m2oName(exp.employee_id);
      const currencyName = m2oName(exp.currency_id) || "MXN";
      const productCategory = m2oName(exp.product_id) || null;
      const statusMap: Record<string, string> = { approved: "approved", done: "paid", reported: "submitted" };
      const expenseData: Record<string, unknown> = {
        company_id: companyId, employee_name: employeeName,
        category: (exp.name as string) || "general",
        description: (exp.description as string) || null,
        amount: Math.abs(Number(exp.total_amount) || 0), currency: currencyName,
        status: statusMap[(exp.state as string)] || "submitted",
        product_category: productCategory,
        payment_mode: (exp.payment_mode as string) || null,
        expense_reference: (exp.reference as string) || null,
        sheet_id: m2oId(exp.sheet_id),
        odoo_id: odooId, source: "odoo",
      };
      const { data: existing } = await query("expenses", { match: { company_id: companyId, odoo_id: odooId }, single: true }).catch(() => ({ data: null }));
      if (!existing) { await insert("expenses", expenseData); }
      else { const { company_id: _, ...uf } = expenseData; await update("expenses", uf, { id: (existing as Record<string, unknown>).id }); }
      totalProcessed++;
    }

    // Merge purchase orders
    for (const po of remotePurchaseOrders) {
      const odooId = po.id as number;
      const partnerName = m2oName(po.partner_id);
      const partnerId = m2oId(po.partner_id);
      const currencyName = m2oName(po.currency_id) || "MXN";
      let vendorId: number | null = null;
      if (partnerId) {
        const { data: vendor } = await query("vendors", { match: { company_id: companyId, odoo_id: partnerId }, single: true }).catch(() => ({ data: null }));
        if (vendor) vendorId = (vendor as Record<string, unknown>).id as number;
      }
      const poData: Record<string, unknown> = {
        company_id: companyId, odoo_id: odooId, name: (po.name as string) || `PO-${odooId}`,
        partner_id: partnerId, partner_name: partnerName, vendor_id: vendorId,
        state: (po.state as string) || null,
        amount_total: Number(po.amount_total) || 0, amount_tax: Number(po.amount_tax) || 0,
        currency: currencyName,
        date_order: (po.date_order as string) || null, date_planned: (po.date_planned as string) || null,
        invoice_status: (po.invoice_status as string) || null, invoice_count: Number(po.invoice_count) || 0,
        notes: (po.notes as string) || null, source: "odoo", updated_at: new Date().toISOString(),
      };
      const { data: existing } = await query("odoo_purchase_orders", { match: { company_id: companyId, odoo_id: odooId }, single: true }).catch(() => ({ data: null }));
      if (!existing) { await insert("odoo_purchase_orders", poData); }
      else { const { company_id: _, ...uf } = poData; await update("odoo_purchase_orders", uf, { id: (existing as Record<string, unknown>).id }); }
      totalProcessed++;
    }

    // ── Done ──
    const status = errors.length ? "partial" : "success";

    await update("integrations", {
      is_connected: true, last_sync_at: new Date().toISOString(),
      last_sync_status: status, last_sync_message: summary, updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "odoo" });

    await completeSyncLog(logId, status, totalProcessed, {
      phase: "done", diff, summary,
      customers: diff.customers?.new || 0, vendors: diff.vendors?.new || 0,
      invoices: diff.invoices?.new || 0, updated: diff.invoices?.updated || 0,
      payments: diff.payments?.new || 0, expenses: diff.expenses?.new || 0,
      purchase_orders: diff.purchase_orders?.new || 0,
    }, errors.length ? errors.join("; ") : undefined);

    return NextResponse.json({
      success: true, message: "Sincronizacion completada",
      diff, summary,
      sync_log_id: logId,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await update("integrations", { last_sync_status: "error", last_sync_message: msg, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { company_id: companyId, provider: "odoo" }).catch(() => {});
    await completeSyncLog(logId, "error", 0, { phase: "error", diff }, msg);
    return NextResponse.json({ success: false, message: `Error en sincronizacion: ${msg}`, sync_log_id: logId });
  }
}

/** Upsert a cached Odoo ID */
async function upsertCache(companyId: number, key: string, odooId: number, displayName?: string) {
  const { data: existing } = await query("odoo_id_cache", { match: { company_id: companyId, cache_key: key }, single: true }).catch(() => ({ data: null }));
  if (existing) {
    await update("odoo_id_cache", { odoo_id: odooId, display_name: displayName, fetched_at: new Date().toISOString() }, { id: (existing as Record<string, unknown>).id });
  } else {
    await insert("odoo_id_cache", { company_id: companyId, cache_key: key, odoo_id: odooId, display_name: displayName });
  }
}

// ════════════════════════════════════════════════════════════════
// FINTOC SYNC — Two-phase: fetch+diff → merge
// ════════════════════════════════════════════════════════════════

async function syncFintoc(companyId: number, config: Record<string, string>) {
  const { secretKey, linkToken } = config;
  if (!secretKey) {
    return NextResponse.json({ success: false, message: "Falta la Secret Key de Fintoc" });
  }
  if (!linkToken) {
    return NextResponse.json({ success: false, message: "Falta el Link Token de Fintoc. Conecta tu cuenta bancaria primero." });
  }

  const logId = await createSyncLog(companyId, "fintoc", "full");
  const errors: string[] = [];
  const diff: SyncDiff = {};
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  try {
    // ── Phase 1: FETCH ──
    await updateSyncLog(logId, { details: { phase: "fetching" } });

    // Fintoc API requires link_token for all account/movement queries
    const accounts = await fintocGet("/accounts", secretKey, { link_token: linkToken }) as Array<Record<string, unknown>>;
    const accountList = Array.isArray(accounts) ? accounts : [];

    // Fetch all movements from all accounts
    const allMovements: Array<{ accountId: string; mov: Record<string, unknown> }> = [];
    for (const account of accountList) {
      const accountId = account.id as string;
      if (!accountId) continue;
      try {
        const movements = await fintocGet(`/accounts/${accountId}/movements`, secretKey, { since, link_token: linkToken }) as Array<Record<string, unknown>>;
        if (Array.isArray(movements)) {
          for (const mov of movements) allMovements.push({ accountId, mov });
        }
      } catch { errors.push(`Movimientos cuenta ${accountId}: error`); }
    }

    // Fetch fiscal invoices (also requires link_token)
    let remoteInvoices: Array<Record<string, unknown>> = [];
    try {
      const invoices = await fintocGet("/invoices", secretKey, { link_token: linkToken }) as Array<Record<string, unknown>>;
      if (Array.isArray(invoices)) remoteInvoices = invoices;
    } catch (e) { errors.push(`Facturas fiscales: ${e instanceof Error ? e.message : "error"}`); }

    // ── Phase 2: DIFF ──
    await updateSyncLog(logId, {
      total_items: allMovements.length + remoteInvoices.length,
      details: { phase: "reviewing", accounts: accountList.length, movements: allMovements.length },
    });

    diff.bank_movements = { new: 0, updated: 0, unchanged: 0 };
    diff.payments = { new: 0, updated: 0, unchanged: 0 };
    for (const { mov } of allMovements) {
      const fintocId = (mov.id as string) || (mov.transaction_id as string);
      if (!fintocId) continue;
      // Check bank_movement existence (unique constraint on fintoc_id)
      const { data: existingBM } = await query("bank_movements", { match: { company_id: companyId, fintoc_id: fintocId }, single: true }).catch(() => ({ data: null }));
      if (!existingBM) { diff.bank_movements.new++; } else { diff.bank_movements.unchanged++; }
      // Check payment existence
      const { data: existingPay } = await query("payments", { match: { company_id: companyId, fintoc_transfer_id: fintocId }, single: true }).catch(() => ({ data: null }));
      if (!existingPay) { diff.payments.new++; } else { diff.payments.unchanged++; }
    }

    if (remoteInvoices.length > 0) {
      diff.invoices = { new: 0, updated: 0, unchanged: 0 };
      for (const inv of remoteInvoices) {
        const invId = inv.id as string;
        const fintocInstitutionId = (inv.institution_id as string) || invId;
        const { data: existing } = await query("invoices", { match: { company_id: companyId, fintoc_institution_id: fintocInstitutionId }, single: true }).catch(() => ({ data: null }));
        if (!existing) { diff.invoices.new++; } else { diff.invoices.unchanged++; }
      }
    }

    const summary = diffSummary(diff);
    await updateSyncLog(logId, {
      details: { phase: "reviewing", diff, summary, accounts: accountList.length, movements: allMovements.length },
    });

    // ── Phase 3: MERGE ──
    await updateSyncLog(logId, {
      details: { phase: "merging", diff, summary, accounts: accountList.length, movements: allMovements.length },
    });

    let totalProcessed = 0;

    for (const { mov } of allMovements) {
      const fintocId = (mov.id as string) || (mov.transaction_id as string);
      if (!fintocId) continue;
      const amount = Number(mov.amount) || 0;
      const senderAccount = (mov.sender_account as Record<string, unknown>)?.number as string || null;

      try {
        await insert("bank_movements", {
          company_id: companyId, fintoc_id: fintocId,
          amount: Math.abs(amount / 100), currency: (mov.currency as string) || "CLP",
          description: (mov.description as string) || null,
          post_date: (mov.post_date as string) || null,
          type: amount > 0 ? "credit" : "debit",
          reference_id: (mov.reference_id as string) || null,
          sender_account: senderAccount,
        });
      } catch { /* ON CONFLICT fintoc_id */ }

      const { data: existing } = await query("payments", { match: { company_id: companyId, fintoc_transfer_id: fintocId }, single: true });
      if (!existing) {
        await insert("payments", {
          company_id: companyId, direction: amount >= 0 ? "inbound" : "outbound",
          status: "confirmed", amount: Math.abs(amount / 100), currency: (mov.currency as string) || "MXN",
          reference_id: (mov.reference_id as string) || (mov.description as string) || null,
          partner_name: (mov.counterpart as Record<string, unknown>)?.name as string || (mov.description as string) || null,
          fintoc_transfer_id: fintocId, executed_at: (mov.post_date as string) || (mov.created_at as string) || new Date().toISOString(),
          source: "fintoc", clabe_origin: senderAccount,
        });
      }
      totalProcessed++;
    }

    // Merge fiscal invoices
    for (const inv of remoteInvoices) {
      const invId = inv.id as string;
      if (!invId) continue;
      const issuer = inv.issuer as Record<string, unknown> | null;
      const receiver = inv.receiver as Record<string, unknown> | null;
      const issueType = inv.issue_type as string;
      const totalAmount = Number(inv.total_amount) || 0;
      const fintocInstitutionId = (inv.institution_id as string) || invId;
      const { data: existing } = await query("invoices", { match: { company_id: companyId, fintoc_institution_id: fintocInstitutionId }, single: true }).catch(() => ({ data: null }));
      if (!existing) {
        await insert("invoices", {
          company_id: companyId, name: (inv.number as string) || `FINTOC-${invId}`,
          type: issueType === "issued" ? "receivable" : "payable",
          partner_name: issueType === "issued" ? (receiver?.name as string) || "" : (issuer?.name as string) || "",
          partner_rfc: issueType === "issued" ? (receiver?.id as string) || null : (issuer?.id as string) || null,
          amount_total: totalAmount / 100, amount_residual: totalAmount / 100,
          date_invoice: (inv.date as string) || null, status: "open",
          cfdi_uuid: null, fintoc_institution_id: fintocInstitutionId, source: "fintoc_fiscal",
        });
      }
      totalProcessed++;
    }

    // ── Done ──
    const status = errors.length ? "partial" : "success";

    await update("integrations", {
      is_connected: true, last_sync_at: new Date().toISOString(),
      last_sync_status: status, last_sync_message: summary, updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "fintoc" });

    await completeSyncLog(logId, status, totalProcessed, {
      phase: "done", diff, summary,
      accounts: accountList.length, movements: allMovements.length,
      new_payments: diff.payments?.new || 0, bank_movements: diff.bank_movements?.new || 0,
      invoices: diff.invoices?.new || 0,
    }, errors.length ? errors.join("; ") : undefined);

    return NextResponse.json({
      success: true, message: "Sincronizacion de Fintoc completada",
      diff, summary, sync_log_id: logId,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await update("integrations", { last_sync_status: "error", last_sync_message: msg, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { company_id: companyId, provider: "fintoc" }).catch(() => {});
    await completeSyncLog(logId, "error", 0, { phase: "error", diff }, msg);
    return NextResponse.json({ success: false, message: `Error: ${msg}`, sync_log_id: logId });
  }
}

// ════════════════════════════════════════════════════════════════
// SAT SYNC — Syntage extraction + local validation
// ════════════════════════════════════════════════════════════════

async function syncSat(companyId: number, config: Record<string, string>) {
  const { rfcEmisor, syntageApiKey } = config;
  if (!rfcEmisor) return NextResponse.json({ success: false, message: "Configuracion SAT incompleta (falta RFC)" });

  // If Syntage API key is configured, use Syntage for extraction
  if (syntageApiKey) {
    return syncSatViaSyntage(companyId, config);
  }

  // Fallback: validate existing CFDIs against SAT directly
  return syncSatDirect(companyId, config);
}

/** Syntage-powered SAT sync: extract CFDIs → diff → merge */
async function syncSatViaSyntage(companyId: number, config: Record<string, string>) {
  const { syntageApiKey, syntageEnvironment, rfcEmisor } = config;
  const logId = await createSyncLog(companyId, "sat", "full");
  const diff: SyncDiff = {};

  try {
    const syntage = createSyntageClient(config);

    // ── Phase 1: FETCH — find taxpayer and extract invoices ──
    await updateSyncLog(logId, { details: { phase: "fetching" } });

    // Find the taxpayer by RFC
    const taxpayers = await syntage.listTaxpayers();
    const taxpayer = taxpayers["hydra:member"].find(t => t.rfc === rfcEmisor);
    if (!taxpayer) {
      await completeSyncLog(logId, "error", 0, { phase: "error" }, `No se encontro contribuyente con RFC ${rfcEmisor} en Syntage`);
      return NextResponse.json({ success: false, message: `No se encontro contribuyente con RFC ${rfcEmisor} en Syntage. Verifica las credenciales.` });
    }

    // Create extraction and wait for it
    const extraction = await syntage.createExtraction(taxpayer.id, "invoice");
    await updateSyncLog(logId, { details: { phase: "fetching", extraction_id: extraction.id, extraction_status: extraction.status } });

    const result = await syntage.waitForExtraction(extraction.id, 300000, 5000);
    if (result.status !== "finished") {
      await completeSyncLog(logId, "error", 0, { phase: "error", extraction_status: result.status }, `Extraccion fallida: ${result.status}`);
      return NextResponse.json({ success: false, message: `Extraccion SAT fallida: ${result.status}` });
    }

    // Fetch all extracted invoices
    const syntageInvoices = await syntage.fetchAllInvoices(taxpayer.id);
    await updateSyncLog(logId, {
      total_items: syntageInvoices.length,
      details: { phase: "reviewing", total_extracted: syntageInvoices.length },
    });

    // ── Phase 2: DIFF ──
    diff.invoices = { new: 0, updated: 0, unchanged: 0 };
    for (const si of syntageInvoices) {
      if (!si.uuid) continue;
      const { data: existing } = await query("invoices", { match: { company_id: companyId, cfdi_uuid: si.uuid }, single: true }).catch(() => ({ data: null }));
      if (!existing) { diff.invoices.new++; } else {
        const ex = existing as Record<string, unknown>;
        // Check if SAT status changed
        if (ex.sat_status !== si.status) { diff.invoices.updated++; }
        else { diff.invoices.unchanged++; }
      }
    }

    const summary = diffSummary(diff);
    await updateSyncLog(logId, { details: { phase: "reviewing", diff, summary, total_extracted: syntageInvoices.length } });

    // ── Phase 3: MERGE ──
    await updateSyncLog(logId, { details: { phase: "merging", diff, summary } });
    let totalProcessed = 0;

    for (const si of syntageInvoices) {
      if (!si.uuid) continue;

      const isEmitted = si.issuer?.rfc === rfcEmisor;
      const invoiceData: Record<string, unknown> = {
        cfdi_uuid: si.uuid,
        sat_status: si.status, // "Vigente" or "Cancelado"
        amount_total: si.total,
        amount_tax: si.subtotal ? si.total - si.subtotal : 0,
        currency: si.currency || "MXN",
        date_invoice: si.issuedAt?.split("T")[0] || null,
        partner_name: isEmitted ? si.receiver?.name : si.issuer?.name,
        partner_rfc: isEmitted ? si.receiver?.rfc : si.issuer?.rfc,
        type: isEmitted ? "receivable" : "payable",
        payment_policy: si.paymentMethod === "PPD" ? "PPD" : si.paymentMethod === "PUE" ? "PUE" : null,
        source: "syntage",
      };

      const { data: existing } = await query("invoices", { match: { company_id: companyId, cfdi_uuid: si.uuid }, single: true }).catch(() => ({ data: null }));
      if (!existing) {
        await insert("invoices", {
          company_id: companyId,
          name: `CFDI-${si.uuid.substring(0, 8)}`,
          status: si.status === "Cancelado" ? "cancelled" : "open",
          ...invoiceData,
        });
      } else {
        const existingRec = existing as Record<string, unknown>;
        // Preserve odoo_id and other locally-set fields
        const updateFields: Record<string, unknown> = { sat_status: si.status };
        // Only update partner info if not already set from Odoo
        if (!existingRec.odoo_id) {
          updateFields.partner_name = invoiceData.partner_name;
          updateFields.partner_rfc = invoiceData.partner_rfc;
          updateFields.amount_total = invoiceData.amount_total;
        }
        if (si.status === "Cancelado" && existingRec.status !== "cancelled") {
          updateFields.status = "cancelled";
        }
        await update("invoices", updateFields, { id: existingRec.id });
      }
      totalProcessed++;
    }

    // ── Done ──
    await update("integrations", {
      is_connected: true, last_sync_at: new Date().toISOString(),
      last_sync_status: "success", last_sync_message: summary, updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "sat" });

    await completeSyncLog(logId, "success", totalProcessed, {
      phase: "done", diff, summary,
      total_extracted: syntageInvoices.length,
      new_invoices: diff.invoices.new, updated: diff.invoices.updated,
    });

    return NextResponse.json({
      success: true, message: "Sincronizacion SAT completada via Syntage",
      diff, summary, sync_log_id: logId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await completeSyncLog(logId, "error", 0, { phase: "error", diff }, msg);
    return NextResponse.json({ success: false, message: `Error en sincronizacion SAT: ${msg}`, sync_log_id: logId });
  }
}

/** Direct SAT validation (fallback when no Syntage key) */
async function syncSatDirect(companyId: number, config: Record<string, string>) {
  const { rfcEmisor } = config;
  const logId = await createSyncLog(companyId, "sat", "revalidate");
  const diff: SyncDiff = {};

  try {
    const { data: invoices } = await query("invoices", { match: { company_id: companyId } });
    const withCfdi = (invoices || []).filter((inv: Record<string, unknown>) => inv.cfdi_uuid);

    await updateSyncLog(logId, {
      total_items: withCfdi.length,
      details: { phase: "fetching", total_cfdis: withCfdi.length },
    });

    // ── Phase 1+2: Validate each CFDI and track status changes ──
    diff.invoices = { new: 0, updated: 0, unchanged: 0 };
    let vigentes = 0, cancelados = 0, errorsCount = 0;

    const results: Array<{ inv: Record<string, unknown>; satStatus: string }> = [];
    for (const inv of withCfdi) {
      try {
        const uuid = inv.cfdi_uuid as string;
        const total = String(Number(inv.amount_total) || 0);
        const isReceivable = inv.type === "receivable";
        const partnerRfc = (inv.partner_rfc as string) || rfcEmisor;
        const satRfcEmisor = isReceivable ? rfcEmisor : partnerRfc;
        const satRfcReceptor = isReceivable ? partnerRfc : rfcEmisor;
        const satStatus = await validateCfdiAgainstSat(uuid, satRfcEmisor, satRfcReceptor, total);
        results.push({ inv, satStatus });

        if (satStatus === "Vigente") vigentes++;
        else if (satStatus === "Cancelado") cancelados++;

        // Track whether status changed
        if (inv.sat_status !== satStatus) { diff.invoices.updated++; }
        else { diff.invoices.unchanged++; }
      } catch { errorsCount++; }

      await updateSyncLog(logId, {
        processed_items: results.length + errorsCount,
        details: {
          phase: "reviewing", diff,
          validated: results.length, vigentes, cancelados, errors: errorsCount,
        },
      });
    }

    const summary = `${results.length} validados: ${vigentes} vigentes, ${cancelados} cancelados${diff.invoices.updated > 0 ? `, ${diff.invoices.updated} cambiaron estado` : ""}`;
    await updateSyncLog(logId, { details: { phase: "reviewing", diff, summary } });

    // ── Phase 3: MERGE — apply status updates ──
    await updateSyncLog(logId, { details: { phase: "merging", diff, summary } });

    for (const { inv, satStatus } of results) {
      await update("invoices", { sat_status: satStatus }, { id: inv.id });
    }

    const status = errorsCount > 0 ? "partial" : "success";
    await update("integrations", {
      is_connected: true, last_sync_at: new Date().toISOString(),
      last_sync_status: status, last_sync_message: summary, updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "sat" });

    await completeSyncLog(logId, status, results.length + errorsCount, {
      phase: "done", diff, summary,
      total_cfdis: withCfdi.length, validated: results.length,
      vigentes, cancelados, errors: errorsCount,
    }, errorsCount > 0 ? `${errorsCount} errores de validacion` : undefined);

    return NextResponse.json({
      success: true, message: `Validacion SAT completada: ${summary}`,
      diff, summary, sync_log_id: logId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await completeSyncLog(logId, "error", 0, { phase: "error", diff }, msg);
    return NextResponse.json({ success: false, message: `Error en validacion SAT: ${msg}`, sync_log_id: logId });
  }
}
