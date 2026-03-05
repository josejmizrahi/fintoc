import { NextRequest, NextResponse } from "next/server";
import { hasDB, query, insert, update } from "@/lib/db";
import { getCompanyId } from "@/lib/auth-helpers";
import { createOdooClient, odooFetchAll, odooSearchRead, odooAuthenticate, m2oId, m2oName } from "@/lib/odoo";
import { fintocGet } from "@/lib/fintoc";
import { validateCfdiAgainstSat, testSatReachability } from "@/lib/sat";

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

// ── POST /api/sync — trigger a sync for a provider ──

export async function POST(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  if (!hasDB()) return NextResponse.json({ detail: "DB no configurada" }, { status: 500 });

  const body = await req.json();
  const { provider } = body as { provider?: string };

  if (!provider || !["odoo", "fintoc", "sat"].includes(provider)) {
    return NextResponse.json({ detail: "Proveedor invalido" }, { status: 400 });
  }

  // Load saved config for this provider
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

// ── Odoo: Full sync ──

async function syncOdoo(companyId: number, config: Record<string, string>) {
  const { url, database, user, password } = config;
  if (!url || !database || !user || !password) {
    return NextResponse.json({ success: false, message: "Configuracion de Odoo incompleta" });
  }

  const logId = await createSyncLog(companyId, "odoo", "full");
  const errors: string[] = [];

  try {
    const client = createOdooClient(config);
    await client.connect();

    let syncedCustomers = 0, syncedVendors = 0, syncedInvoices = 0, updatedInvoices = 0;
    let syncedPayments = 0, syncedExpenses = 0, syncedPurchaseOrders = 0;
    let totalProcessed = 0;

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
          // Prefer l10n_mx_edi_clabe, fallback to acc_number
          const clabe = (b.l10n_mx_edi_clabe as string) || (b.acc_number as string) || "";
          const bankName = m2oName(b.bank_id);
          if (partnerId && clabe && !bankMap.has(partnerId)) {
            bankMap.set(partnerId, { clabe, bankName });
          }
        }
      } catch { /* res.partner.bank may not be accessible */ }
      return bankMap;
    }

    // ── Cache Odoo IDs (journal, currency, payment method) ──
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

    // ── Customers ──
    try {
      const customers = await client.fetchAll("res.partner",
        [["customer_rank", ">", 0]],
        ["id", "name", "vat", "email", "phone", "bank_ids",
         "customer_rank", "l10n_mx_edi_fiscal_regime", "property_payment_term_id"]);
      await updateSyncLog(logId, { total_items: customers.length, details: { phase: "customers", total_fetched: customers.length } });

      const customerBankIds = customers
        .filter(c => Array.isArray(c.bank_ids) && (c.bank_ids as number[]).length > 0)
        .map(c => c.id as number);
      const customerBanks = await fetchPartnerBankInfo(customerBankIds);

      for (const c of customers) {
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
          const { data: byRfc } = rfc
            ? await query("customers", { match: { company_id: companyId, rfc }, single: true })
            : { data: null };
          if (byRfc) {
            await update("customers", customerData, { id: (byRfc as Record<string, unknown>).id });
          } else {
            await insert("customers", { company_id: companyId, ...customerData });
          }
          syncedCustomers++;
        } else {
          await update("customers", customerData, { id: (existing as Record<string, unknown>).id });
        }
        totalProcessed++;
      }
      await updateSyncLog(logId, { processed_items: totalProcessed, details: { phase: "vendors", customers: syncedCustomers } });
    } catch (e) { errors.push(`Clientes: ${e instanceof Error ? e.message : "error"}`); }

    // ── Vendors ──
    try {
      const vendors = await client.fetchAll("res.partner",
        [["supplier_rank", ">", 0]],
        ["id", "name", "vat", "email", "phone", "bank_ids",
         "supplier_rank", "l10n_mx_edi_fiscal_regime", "property_payment_term_id"]);

      const vendorBankIds = vendors
        .filter(v => Array.isArray(v.bank_ids) && (v.bank_ids as number[]).length > 0)
        .map(v => v.id as number);
      const vendorBanks = await fetchPartnerBankInfo(vendorBankIds);

      for (const v of vendors) {
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
          const { data: byRfc } = rfc
            ? await query("vendors", { match: { company_id: companyId, rfc }, single: true })
            : { data: null };
          if (byRfc) {
            await update("vendors", vendorData, { id: (byRfc as Record<string, unknown>).id });
          } else {
            await insert("vendors", { company_id: companyId, ...vendorData });
          }
          syncedVendors++;
        } else {
          await update("vendors", vendorData, { id: (existing as Record<string, unknown>).id });
        }
        totalProcessed++;
      }
      await updateSyncLog(logId, { processed_items: totalProcessed, details: { phase: "invoices", customers: syncedCustomers, vendors: syncedVendors } });
    } catch (e) { errors.push(`Proveedores: ${e instanceof Error ? e.message : "error"}`); }

    // ── Invoices (with full l10n_mx_edi fields) ──
    try {
      const invoices = await client.fetchAll("account.move",
        [["move_type", "in", ["out_invoice", "in_invoice", "out_refund", "in_refund"]]],
        ["id", "name", "partner_id", "move_type", "state", "payment_state",
         "amount_total", "amount_residual", "amount_tax",
         "invoice_date", "invoice_date_due", "currency_id",
         "l10n_mx_edi_cfdi_uuid", "l10n_mx_edi_payment_policy",
         "l10n_mx_edi_usage", "l10n_mx_edi_payment_method_id",
         "invoice_line_ids"]);

      // Batch fetch partner RFCs
      const partnerIds = [...new Set(invoices
        .map(inv => m2oId(inv.partner_id))
        .filter((id): id is number => id !== null))];
      const rfcMap = new Map<number, string>();
      if (partnerIds.length > 0) {
        try {
          const partners = await client.searchRead("res.partner",
            [["id", "in", partnerIds]], ["id", "vat", "name"]);
          for (const p of partners) {
            if (p.vat) rfcMap.set(p.id as number, p.vat as string);
          }
        } catch { /* continue without RFC */ }
      }

      for (const inv of invoices) {
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

        let existing = null;
        const { data: byOdooId } = await query("invoices", { match: { company_id: companyId, odoo_id: odooId }, single: true }).catch(() => ({ data: null }));
        existing = byOdooId;
        if (!existing && cfdiUuid) {
          const q = await query("invoices", { match: { company_id: companyId, cfdi_uuid: cfdiUuid }, single: true });
          existing = q.data;
        }
        if (!existing) {
          const q = await query("invoices", { match: { company_id: companyId, name: odooRef }, single: true });
          existing = q.data;
        }

        const isPayable = moveType === "in_invoice" || moveType === "in_refund";
        const invoiceData: Record<string, unknown> = {
          company_id: companyId, name: odooRef, odoo_id: odooId, source: "odoo",
          type: isPayable ? "payable" : "receivable",
          move_type: moveType,
          partner_name: partnerName, partner_rfc: partnerRfc,
          amount_total: Number(inv.amount_total) || 0,
          amount_residual: Number(inv.amount_residual) || 0,
          amount_tax: Number(inv.amount_tax) || 0,
          date_invoice: (inv.invoice_date as string) || null,
          date_due: (inv.invoice_date_due as string) || null,
          status: inv.state === "posted" ? "open" : inv.state === "cancel" ? "cancelled" : "draft",
          payment_state: (inv.payment_state as string) || null,
          cfdi_uuid: cfdiUuid,
          odoo_cfdi_uuid: cfdiUuid,
          payment_policy: paymentPolicy === "ppd" || paymentPolicy === "PPD" ? "PPD" : paymentPolicy === "pue" || paymentPolicy === "PUE" ? "PUE" : null,
          odoo_usage: usoCfdi,
          odoo_payment_method: paymentMethod,
          currency: currencyName,
          invoice_line_count: lineIds,
        };

        if (!existing) {
          await insert("invoices", invoiceData);
          syncedInvoices++;
        } else {
          const existingRec = existing as Record<string, unknown>;
          // Preserve locally-set fields, update from Odoo
          const updateData: Record<string, unknown> = { ...invoiceData };
          delete updateData.company_id;
          // Don't overwrite cfdi_uuid if local one exists and Odoo doesn't have it
          if (!cfdiUuid && existingRec.cfdi_uuid) delete updateData.cfdi_uuid;
          await update("invoices", updateData, { id: existingRec.id });
          updatedInvoices++;
        }
        totalProcessed++;
      }
      await updateSyncLog(logId, { processed_items: totalProcessed, details: { phase: "payments", customers: syncedCustomers, vendors: syncedVendors, invoices: syncedInvoices, updated: updatedInvoices } });
    } catch (e) { errors.push(`Facturas: ${e instanceof Error ? e.message : "error"}`); }

    // ── Payments (with reconciliation tracking) ──
    try {
      const payments = await client.fetchAll("account.payment",
        [["state", "in", ["posted", "sent", "reconciled"]]],
        ["id", "name", "partner_id", "amount", "payment_type", "partner_type",
         "date", "ref", "currency_id", "state", "journal_id",
         "reconciled_invoice_ids"]);

      const payPartnerIds = [...new Set(payments
        .map(p => m2oId(p.partner_id))
        .filter((id): id is number => id !== null))];
      const payRfcMap = new Map<number, string>();
      if (payPartnerIds.length > 0) {
        try {
          const partners = await client.searchRead("res.partner",
            [["id", "in", payPartnerIds]], ["id", "vat"]);
          for (const p of partners) {
            if (p.vat) payRfcMap.set(p.id as number, p.vat as string);
          }
        } catch { /* continue without RFC */ }
      }

      for (const p of payments) {
        const odooId = p.id as number;
        const ref = (p.ref as string) || (p.name as string) || `ODOO-PAY-${p.id}`;
        const partnerName = m2oName(p.partner_id);
        const partnerId = m2oId(p.partner_id);
        const partnerRfc = partnerId ? (payRfcMap.get(partnerId) || null) : null;
        const currencyName = m2oName(p.currency_id) || "MXN";
        const reconciled = Array.isArray(p.reconciled_invoice_ids) ? p.reconciled_invoice_ids : [];

        const paymentData: Record<string, unknown> = {
          company_id: companyId,
          direction: p.payment_type === "inbound" ? "inbound" : "outbound",
          status: "confirmed",
          amount: Math.abs(Number(p.amount) || 0),
          currency: currencyName,
          reference_id: ref,
          partner_name: partnerName,
          partner_rfc: partnerRfc,
          executed_at: (p.date as string) || new Date().toISOString(),
          odoo_id: odooId,
          odoo_state: (p.state as string) || null,
          reconciled_invoice_ids: reconciled.length > 0 ? JSON.stringify(reconciled) : null,
          source: "odoo",
        };

        const { data: existing } = await query("payments", { match: { company_id: companyId, odoo_id: odooId }, single: true }).catch(() => ({ data: null }));
        if (!existing) {
          await insert("payments", paymentData);
          syncedPayments++;
        } else {
          const existingRec = existing as Record<string, unknown>;
          const { company_id: _, ...updateFields } = paymentData;
          await update("payments", updateFields, { id: existingRec.id });
        }
        totalProcessed++;
      }
    } catch (e) { errors.push(`Pagos: ${e instanceof Error ? e.message : "error"}`); }

    // ── Expenses (with product category and payment mode) ──
    try {
      const expenses = await client.fetchAll("hr.expense",
        [["state", "in", ["approved", "done", "reported"]]],
        ["id", "name", "employee_id", "total_amount", "currency_id", "date",
         "state", "description", "product_id", "payment_mode", "reference", "sheet_id"]);

      for (const exp of expenses) {
        const odooId = exp.id as number;
        const employeeName = m2oName(exp.employee_id);
        const currencyName = m2oName(exp.currency_id) || "MXN";
        const productCategory = m2oName(exp.product_id) || null;
        const statusMap: Record<string, string> = { approved: "approved", done: "paid", reported: "submitted" };

        const expenseData: Record<string, unknown> = {
          company_id: companyId,
          employee_name: employeeName,
          category: (exp.name as string) || "general",
          description: (exp.description as string) || null,
          amount: Math.abs(Number(exp.total_amount) || 0),
          currency: currencyName,
          status: statusMap[(exp.state as string)] || "submitted",
          product_category: productCategory,
          payment_mode: (exp.payment_mode as string) || null,
          expense_reference: (exp.reference as string) || null,
          sheet_id: m2oId(exp.sheet_id),
          odoo_id: odooId,
          source: "odoo",
        };

        const { data: existing } = await query("expenses", { match: { company_id: companyId, odoo_id: odooId }, single: true }).catch(() => ({ data: null }));
        if (!existing) {
          await insert("expenses", expenseData);
          syncedExpenses++;
        } else {
          const { company_id: _, ...updateFields } = expenseData;
          await update("expenses", updateFields, { id: (existing as Record<string, unknown>).id });
        }
        totalProcessed++;
      }
    } catch { /* hr.expense module may not be installed */ }

    // ── Purchase Orders (new) ──
    try {
      const orders = await client.fetchAll("purchase.order",
        [["state", "in", ["purchase", "done"]]],
        ["id", "name", "partner_id", "state", "amount_total", "amount_tax",
         "currency_id", "date_order", "date_planned", "invoice_status", "invoice_count", "notes"]);

      for (const po of orders) {
        const odooId = po.id as number;
        const partnerName = m2oName(po.partner_id);
        const partnerId = m2oId(po.partner_id);
        const currencyName = m2oName(po.currency_id) || "MXN";

        // Try to link to local vendor
        let vendorId: number | null = null;
        if (partnerId) {
          const { data: vendor } = await query("vendors", { match: { company_id: companyId, odoo_id: partnerId }, single: true }).catch(() => ({ data: null }));
          if (vendor) vendorId = (vendor as Record<string, unknown>).id as number;
        }

        const poData: Record<string, unknown> = {
          company_id: companyId, odoo_id: odooId, name: (po.name as string) || `PO-${odooId}`,
          partner_id: partnerId, partner_name: partnerName,
          vendor_id: vendorId,
          state: (po.state as string) || null,
          amount_total: Number(po.amount_total) || 0,
          amount_tax: Number(po.amount_tax) || 0,
          currency: currencyName,
          date_order: (po.date_order as string) || null,
          date_planned: (po.date_planned as string) || null,
          invoice_status: (po.invoice_status as string) || null,
          invoice_count: Number(po.invoice_count) || 0,
          notes: (po.notes as string) || null,
          source: "odoo",
          updated_at: new Date().toISOString(),
        };

        const { data: existing } = await query("odoo_purchase_orders", { match: { company_id: companyId, odoo_id: odooId }, single: true }).catch(() => ({ data: null }));
        if (!existing) {
          await insert("odoo_purchase_orders", poData);
          syncedPurchaseOrders++;
        } else {
          const { company_id: _, ...updateFields } = poData;
          await update("odoo_purchase_orders", updateFields, { id: (existing as Record<string, unknown>).id });
        }
        totalProcessed++;
      }
    } catch { /* purchase module may not be installed */ }

    const syncMsg = `Clientes: +${syncedCustomers}, Proveedores: +${syncedVendors}, Facturas: +${syncedInvoices} (${updatedInvoices} act.), Pagos: +${syncedPayments}${syncedExpenses ? `, Gastos: +${syncedExpenses}` : ""}${syncedPurchaseOrders ? `, OC: +${syncedPurchaseOrders}` : ""}${errors.length ? ` | Errores: ${errors.join("; ")}` : ""}`;
    const status = errors.length ? "partial" : "success";

    await update("integrations", {
      is_connected: true, last_sync_at: new Date().toISOString(),
      last_sync_status: status, last_sync_message: syncMsg, updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "odoo" });

    await completeSyncLog(logId, status, totalProcessed, {
      customers: syncedCustomers, vendors: syncedVendors, invoices: syncedInvoices, updated: updatedInvoices,
      payments: syncedPayments, expenses: syncedExpenses, purchase_orders: syncedPurchaseOrders,
    }, errors.length ? errors.join("; ") : undefined);

    return NextResponse.json({
      success: true, message: "Sincronizacion completada",
      synced: {
        customers: syncedCustomers, vendors: syncedVendors,
        invoices: syncedInvoices, updated: updatedInvoices,
        payments: syncedPayments, expenses: syncedExpenses,
        purchase_orders: syncedPurchaseOrders,
      },
      sync_log_id: logId,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await update("integrations", { last_sync_status: "error", last_sync_message: msg, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { company_id: companyId, provider: "odoo" }).catch(() => {});
    await completeSyncLog(logId, "error", 0, {}, msg);
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

// ── Fintoc: Full sync ──

async function syncFintoc(companyId: number, config: Record<string, string>) {
  const { secretKey, linkToken } = config;
  if (!secretKey) {
    return NextResponse.json({ success: false, message: "Falta la Secret Key de Fintoc" });
  }

  const logId = await createSyncLog(companyId, "fintoc", "full");
  const errors: string[] = [];
  let totalAccounts = 0, totalMovements = 0, newPayments = 0, newBankMovements = 0, totalInvoices = 0;
  let totalProcessed = 0;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  try {
    const accounts = await fintocGet("/accounts", secretKey) as Array<Record<string, unknown>>;
    totalAccounts = Array.isArray(accounts) ? accounts.length : 0;
    await updateSyncLog(logId, { details: { phase: "movements", accounts: totalAccounts } });

    for (const account of (Array.isArray(accounts) ? accounts : [])) {
      const accountId = account.id as string;
      if (!accountId) continue;
      try {
        const movements = await fintocGet(`/accounts/${accountId}/movements`, secretKey, { since }) as Array<Record<string, unknown>>;
        if (!Array.isArray(movements)) continue;
        totalMovements += movements.length;

        for (const mov of movements) {
          const fintocId = (mov.id as string) || (mov.transaction_id as string);
          if (!fintocId) continue;
          const amount = Number(mov.amount) || 0;
          const senderAccount = (mov.sender_account as Record<string, unknown>)?.number as string || null;

          try {
            await insert("bank_movements", {
              company_id: companyId,
              fintoc_id: fintocId,
              amount: Math.abs(amount / 100),
              currency: (mov.currency as string) || "CLP",
              description: (mov.description as string) || null,
              post_date: (mov.post_date as string) || null,
              type: amount > 0 ? "credit" : "debit",
              reference_id: (mov.reference_id as string) || null,
              sender_account: senderAccount,
            });
            newBankMovements++;
          } catch { /* ON CONFLICT fintoc_id — already exists */ }

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
            newPayments++;
          }
          totalProcessed++;
        }
        await updateSyncLog(logId, { processed_items: totalProcessed, total_items: totalMovements, details: { phase: "movements", accounts: totalAccounts, movements: totalMovements, new_payments: newPayments, bank_movements: newBankMovements } });
      } catch { errors.push(`Movimientos cuenta ${accountId}: error`); }
    }

    // Fiscal invoices
    if (linkToken) {
      try {
        await updateSyncLog(logId, { details: { phase: "invoices", accounts: totalAccounts, movements: totalMovements, new_payments: newPayments } });
        const invoices = await fintocGet("/invoices", secretKey, { link_token: linkToken }) as Array<Record<string, unknown>>;
        if (Array.isArray(invoices)) {
          totalInvoices = invoices.length;
          for (const inv of invoices) {
            const invId = inv.id as string;
            if (!invId) continue;
            const issuer = inv.issuer as Record<string, unknown> | null;
            const receiver = inv.receiver as Record<string, unknown> | null;
            const issueType = inv.issue_type as string;
            const totalAmount = Number(inv.total_amount) || 0;
            const fintocInstitutionId = (inv.institution_id as string) || null;
            const { data: existing } = await query("invoices", { match: { company_id: companyId, fintoc_institution_id: fintocInstitutionId || invId }, single: true }).catch(() => ({ data: null }));
            if (!existing) {
              await insert("invoices", {
                company_id: companyId, name: (inv.number as string) || `FINTOC-${invId}`,
                type: issueType === "issued" ? "receivable" : "payable",
                partner_name: issueType === "issued" ? (receiver?.name as string) || "" : (issuer?.name as string) || "",
                partner_rfc: issueType === "issued" ? (receiver?.id as string) || null : (issuer?.id as string) || null,
                amount_total: totalAmount / 100, amount_residual: totalAmount / 100,
                date_invoice: (inv.date as string) || null, status: "open",
                cfdi_uuid: null,
                fintoc_institution_id: fintocInstitutionId || invId,
                source: "fintoc_fiscal",
              });
            }
            totalProcessed++;
          }
        }
      } catch (e) { errors.push(`Facturas fiscales: ${e instanceof Error ? e.message : "error"}`); }
    }

    const syncMsg = `${totalAccounts} cuentas, ${totalMovements} movimientos (${newPayments} nuevos, ${newBankMovements} raw)${totalInvoices > 0 ? `, ${totalInvoices} facturas fiscales` : ""}${errors.length ? ` | ${errors.join("; ")}` : ""}`;
    const status = errors.length ? "partial" : "success";

    await update("integrations", {
      is_connected: true, last_sync_at: new Date().toISOString(),
      last_sync_status: status, last_sync_message: syncMsg, updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "fintoc" });

    await completeSyncLog(logId, status, totalProcessed, {
      accounts: totalAccounts, movements: totalMovements, new_payments: newPayments, bank_movements: newBankMovements, invoices: totalInvoices,
    }, errors.length ? errors.join("; ") : undefined);

    return NextResponse.json({
      success: true, message: "Sincronizacion de Fintoc completada",
      synced: { accounts: totalAccounts, movements: totalMovements, new_payments: newPayments, bank_movements: newBankMovements, invoices: totalInvoices },
      sync_log_id: logId,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await update("integrations", { last_sync_status: "error", last_sync_message: msg, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { company_id: companyId, provider: "fintoc" }).catch(() => {});
    await completeSyncLog(logId, "error", 0, {}, msg);
    return NextResponse.json({ success: false, message: `Error: ${msg}`, sync_log_id: logId });
  }
}

// ── SAT: Sync (revalidate CFDIs) ──

async function syncSat(companyId: number, config: Record<string, string>) {
  const { rfcEmisor } = config;
  if (!rfcEmisor) return NextResponse.json({ success: false, message: "Configuracion SAT incompleta (falta RFC)" });

  try {
    const { data: invoices } = await query("invoices", { match: { company_id: companyId } });
    const withCfdi = (invoices || []).filter((inv: Record<string, unknown>) => inv.cfdi_uuid);

    const logId = await createSyncLog(companyId, "sat", "revalidate", withCfdi.length);
    let validated = 0, vigentes = 0, cancelados = 0, errorsCount = 0;

    for (const inv of withCfdi) {
      try {
        const uuid = inv.cfdi_uuid as string;
        const total = String(Number(inv.amount_total) || 0);
        const isReceivable = inv.type === "receivable";
        const partnerRfc = (inv.partner_rfc as string) || rfcEmisor;
        const satRfcEmisor = isReceivable ? rfcEmisor : partnerRfc;
        const satRfcReceptor = isReceivable ? partnerRfc : rfcEmisor;
        const satStatus = await validateCfdiAgainstSat(uuid, satRfcEmisor, satRfcReceptor, total);
        await update("invoices", { sat_status: satStatus }, { id: inv.id });
        validated++;
        if (satStatus === "Vigente") vigentes++;
        else if (satStatus === "Cancelado") cancelados++;
      } catch { errorsCount++; }

      await updateSyncLog(logId, {
        processed_items: validated + errorsCount,
        details: { validated, vigentes, cancelados, errors: errorsCount },
      });
    }

    const syncMsg = `${validated} validados: ${vigentes} vigentes, ${cancelados} cancelados${errorsCount > 0 ? `, ${errorsCount} errores` : ""}`;
    const status = errorsCount > 0 ? "partial" : "success";

    await update("integrations", {
      is_connected: true, last_sync_at: new Date().toISOString(),
      last_sync_status: status, last_sync_message: syncMsg, updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "sat" });

    await completeSyncLog(logId, status, validated + errorsCount, {
      total_cfdis: withCfdi.length, validated, vigentes, cancelados, errors: errorsCount,
    }, errorsCount > 0 ? `${errorsCount} errores de validacion` : undefined);

    return NextResponse.json({
      success: true, message: `Validacion SAT completada: ${syncMsg}`,
      validated, vigentes, cancelados, errors: errorsCount,
      sync_log_id: logId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ success: false, message: `Error en validacion SAT: ${msg}` });
  }
}
