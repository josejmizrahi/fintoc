/**
 * Odoo API Handlers — Write-back, bank statements, purchase orders, and model exploration
 */

import { NextResponse } from "next/server";
import { query, insert, update } from "@/lib/db";
import {
  writeBackPaymentToOdoo,
  pushBankStatementsToOdoo,
  writeBackVendorToOdoo,
  writeBackCustomerToOdoo,
  writeBackInvoiceStatus,
  getOdooModelFields,
  getOdooRecordCount,
} from "@/lib/odoo-writeback";

// ── GET handlers ──

export async function handleOdooGet(path: string, companyId: number): Promise<Response | null> {
  // GET odoo/purchase-orders — list synced purchase orders
  if (path === "odoo/purchase-orders") {
    const { data } = await query("odoo_purchase_orders", {
      match: { company_id: companyId },
      order: { column: "date_order", ascending: false },
      limit: 200,
    });
    return NextResponse.json(data || []);
  }

  // GET odoo/bank-statements — list pushed bank statement lines
  if (path === "odoo/bank-statements") {
    const { data } = await query("odoo_bank_statements", {
      match: { company_id: companyId },
      order: { column: "created_at", ascending: false },
      limit: 200,
    });
    return NextResponse.json(data || []);
  }

  // GET odoo/id-cache — list cached Odoo IDs
  if (path === "odoo/id-cache") {
    const { data } = await query("odoo_id_cache", {
      match: { company_id: companyId },
    });
    return NextResponse.json(data || []);
  }

  // GET odoo/stats — Odoo integration statistics
  if (path === "odoo/stats") {
    const [vendors, customers, invoices, payments, expenses, pos, bankStatements] = await Promise.all([
      query("vendors", { match: { company_id: companyId, source: "odoo" } }).then(r => (r.data as unknown[])?.length || 0),
      query("customers", { match: { company_id: companyId, source: "odoo" } }).then(r => (r.data as unknown[])?.length || 0),
      query("invoices", { match: { company_id: companyId, source: "odoo" } }).then(r => (r.data as unknown[])?.length || 0),
      query("payments", { match: { company_id: companyId, source: "odoo" } }).then(r => (r.data as unknown[])?.length || 0),
      query("expenses", { match: { company_id: companyId, source: "odoo" } }).then(r => (r.data as unknown[])?.length || 0),
      query("odoo_purchase_orders", { match: { company_id: companyId } }).then(r => (r.data as unknown[])?.length || 0).catch(() => 0),
      query("odoo_bank_statements", { match: { company_id: companyId } }).then(r => (r.data as unknown[])?.length || 0).catch(() => 0),
    ]);

    // Count invoices missing l10n_mx data
    const { data: allInvoices } = await query("invoices", { match: { company_id: companyId, source: "odoo" } });
    const invoicesList = (allInvoices || []) as Record<string, unknown>[];
    const missingCfdi = invoicesList.filter(i => !i.cfdi_uuid && !i.odoo_cfdi_uuid).length;
    const withPPD = invoicesList.filter(i => i.payment_policy === "PPD").length;
    const withPaymentState = invoicesList.filter(i => i.payment_state).length;

    return NextResponse.json({
      vendors, customers, invoices, payments, expenses,
      purchase_orders: pos,
      bank_statements: bankStatements,
      invoices_missing_cfdi: missingCfdi,
      invoices_ppd: withPPD,
      invoices_with_payment_state: withPaymentState,
    });
  }

  return null; // Not handled
}

// ── POST handlers ──

export async function handleOdooPost(path: string, companyId: number, body: Record<string, unknown>): Promise<Response | null> {
  // POST odoo/bank-statements/push — push Fintoc movements to Odoo as bank statement lines
  if (path === "odoo/bank-statements/push") {
    const days = Number(body.days) || 7;

    // Get recent bank movements not yet pushed
    const { data: movements } = await query("bank_movements", {
      match: { company_id: companyId },
      order: { column: "post_date", ascending: false },
      limit: 500,
    });

    if (!movements || (movements as unknown[]).length === 0) {
      return NextResponse.json({ success: true, message: "No hay movimientos para enviar", created: 0 });
    }

    const movementList = (movements as Record<string, unknown>[]).filter(m => {
      const postDate = m.post_date as string;
      if (!postDate) return false;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      return postDate >= cutoff;
    });

    // Map movements to statement data
    const stmtMovements = movementList.map(m => ({
      bankMovementId: m.id as number,
      date: ((m.post_date as string) || new Date().toISOString()).split("T")[0],
      paymentRef: (m.description as string) || (m.reference_id as string) || `MOV-${m.id}`,
      amount: m.type === "debit" ? -Math.abs(Number(m.amount)) : Math.abs(Number(m.amount)),
    }));

    const result = await pushBankStatementsToOdoo({
      companyId,
      movements: stmtMovements,
    });

    return NextResponse.json(result);
  }

  // POST odoo/vendor/create — create vendor in Odoo
  if (path === "odoo/vendor/create") {
    const { name, rfc, email, phone, clabe } = body as Record<string, string>;
    if (!name) return NextResponse.json({ detail: "Nombre requerido" }, { status: 400 });

    const result = await writeBackVendorToOdoo(companyId, { name, rfc, email, phone, clabe });

    // Update local vendor with odoo_id if successful
    if (result.success && result.odooId && rfc) {
      const { data: vendor } = await query("vendors", { match: { company_id: companyId, rfc }, single: true }).catch(() => ({ data: null }));
      if (vendor) {
        await update("vendors", { odoo_id: result.odooId }, { id: (vendor as Record<string, unknown>).id });
      }
    }

    return NextResponse.json(result);
  }

  // POST odoo/customer/create — create customer in Odoo
  if (path === "odoo/customer/create") {
    const { name, rfc, email, phone } = body as Record<string, string>;
    if (!name) return NextResponse.json({ detail: "Nombre requerido" }, { status: 400 });

    const result = await writeBackCustomerToOdoo(companyId, { name, rfc, email, phone });

    if (result.success && result.odooId && rfc) {
      const { data: customer } = await query("customers", { match: { company_id: companyId, rfc }, single: true }).catch(() => ({ data: null }));
      if (customer) {
        await update("customers", { odoo_id: result.odooId }, { id: (customer as Record<string, unknown>).id });
      }
    }

    return NextResponse.json(result);
  }

  // POST odoo/invoice/action — execute action on Odoo invoice
  if (path === "odoo/invoice/action") {
    const invoiceId = Number(body.invoice_id);
    const action = body.action as "post" | "cancel" | "draft";
    if (!invoiceId || !action) {
      return NextResponse.json({ detail: "invoice_id y action requeridos" }, { status: 400 });
    }

    // Get odoo_id from local invoice
    const { data: invoice } = await query("invoices", { match: { company_id: companyId, id: invoiceId }, single: true });
    if (!invoice) return NextResponse.json({ detail: "Factura no encontrada" }, { status: 404 });

    const odooId = (invoice as Record<string, unknown>).odoo_id as number;
    if (!odooId) return NextResponse.json({ detail: "Factura no tiene odoo_id" }, { status: 400 });

    const result = await writeBackInvoiceStatus(companyId, odooId, action);
    return NextResponse.json(result);
  }

  // POST odoo/model/fields — explore Odoo model fields
  if (path === "odoo/model/fields") {
    const model = body.model as string;
    if (!model) return NextResponse.json({ detail: "model requerido" }, { status: 400 });

    const result = await getOdooModelFields(companyId, model);
    return NextResponse.json(result);
  }

  // POST odoo/model/count — count records in Odoo model
  if (path === "odoo/model/count") {
    const model = body.model as string;
    const domain = (body.domain as unknown[][]) || [];
    if (!model) return NextResponse.json({ detail: "model requerido" }, { status: 400 });

    const result = await getOdooRecordCount(companyId, model, domain);
    return NextResponse.json(result);
  }

  return null; // Not handled
}
