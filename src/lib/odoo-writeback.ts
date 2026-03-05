/**
 * Odoo Write-Back: Bidirectional sync operations
 *
 * Includes:
 * - Create account.payment in Odoo when payments are confirmed
 * - Confirm payments (action_post)
 * - Reconcile payments with invoices
 * - Trigger complemento de pago for PPD invoices
 * - Create account.bank.statement.line from Fintoc movements
 * - Update invoice status in Odoo
 */

import { query, insert, update } from "@/lib/db";
import { createOdooClient, OdooClient, m2oId } from "@/lib/odoo";

// ── Types ──

interface OdooPaymentData {
  companyId: number;
  paymentId: number;
  amount: number;
  direction: "inbound" | "outbound";
  partnerRfc?: string | null;
  partnerName?: string | null;
  reference?: string;
  date?: string;
  invoiceOdooId?: number | null;
  currencyCode?: string;
}

interface WriteBackResult {
  success: boolean;
  odooPaymentId?: number;
  complementoTriggered?: boolean;
  error?: string;
}

interface BankStatementData {
  companyId: number;
  movements: Array<{
    bankMovementId?: number;
    paymentId?: number;
    date: string;
    paymentRef: string;
    amount: number;
    partnerOdooId?: number | null;
    partnerName?: string;
  }>;
}

interface BankStatementResult {
  success: boolean;
  created: number;
  errors: string[];
}

// ── Helpers: Load config and cached IDs ──

async function loadOdooClient(companyId: number): Promise<{ client: OdooClient; error?: string }> {
  const { data: integration } = await query("integrations", {
    match: { company_id: companyId, provider: "odoo" },
    single: true,
  });

  if (!integration?.config) {
    return { client: null as unknown as OdooClient, error: "Odoo no esta configurado" };
  }

  const config = integration.config as Record<string, string>;
  try {
    const client = createOdooClient(config);
    await client.connect();
    return { client };
  } catch (e) {
    return { client: null as unknown as OdooClient, error: e instanceof Error ? e.message : "Error de conexion" };
  }
}

async function getCachedId(companyId: number, key: string): Promise<number | null> {
  const { data } = await query("odoo_id_cache", {
    match: { company_id: companyId, cache_key: key },
    single: true,
  }).catch(() => ({ data: null }));
  return data ? (data as Record<string, unknown>).odoo_id as number : null;
}

// ── Write-back: Create payment in Odoo ──

/**
 * Push a confirmed payment to Odoo as an account.payment record.
 * Uses cached IDs for journal and currency when available.
 * Optionally reconciles with an invoice and triggers complemento de pago.
 */
export async function writeBackPaymentToOdoo(data: OdooPaymentData): Promise<WriteBackResult> {
  const { client, error } = await loadOdooClient(data.companyId);
  if (error) return { success: false, error };

  try {
    // Step 1: Find partner in Odoo by RFC or name
    let partnerId: number | null = null;
    if (data.partnerRfc) {
      partnerId = await client.findPartnerByRfc(data.partnerRfc);
    }
    if (!partnerId && data.partnerName) {
      partnerId = await client.findPartnerByName(data.partnerName);
    }

    // Step 2: Get cached IDs or look them up
    let journalId = await getCachedId(data.companyId, "bank_journal_id");
    let currencyId = await getCachedId(data.companyId, "mxn_currency_id");

    if (!journalId) {
      journalId = await client.findBankJournalId();
    }
    if (!currencyId && (data.currencyCode || "MXN") === "MXN") {
      currencyId = await client.findCurrencyId("MXN");
    }

    if (!journalId) {
      return { success: false, error: "No se encontro diario bancario en Odoo" };
    }

    // Step 3: Create account.payment
    const paymentType = data.direction === "outbound" ? "outbound" : "inbound";
    const partnerType = data.direction === "outbound" ? "supplier" : "customer";

    const paymentRecord: Record<string, unknown> = {
      payment_type: paymentType,
      partner_type: partnerType,
      amount: data.amount,
      journal_id: journalId,
      ref: data.reference || `FINTOC-PAY-${data.paymentId}`,
      date: data.date || new Date().toISOString().split("T")[0],
    };

    if (partnerId) paymentRecord.partner_id = partnerId;
    if (currencyId) paymentRecord.currency_id = currencyId;

    // Try to get payment method line for completeness
    const methodLineId = await getCachedId(data.companyId, "transfer_method_line_id");
    if (methodLineId) paymentRecord.payment_method_line_id = methodLineId;

    const odooPaymentId = await client.create("account.payment", paymentRecord);

    // Step 4: Confirm payment (action_post)
    try {
      await client.callAction("account.payment", "action_post", [odooPaymentId]);
    } catch {
      // Some Odoo versions use action_validate_invoice_payment
      try {
        await client.callAction("account.payment", "action_validate_invoice_payment", [odooPaymentId]);
      } catch { /* Payment created but not confirmed — manual intervention needed */ }
    }

    // Step 5: Update Supabase with odoo_payment_id and state
    await update("payments", {
      odoo_payment_id: odooPaymentId,
      odoo_state: "posted",
    }, { id: data.paymentId, company_id: data.companyId });

    // Step 6: Try to trigger complemento de pago for PPD invoices
    let complementoTriggered = false;
    if (data.invoiceOdooId) {
      try {
        await client.callAction("account.move",
          "l10n_mx_edi_cfdi_invoice_try_send", [data.invoiceOdooId]);
        complementoTriggered = true;

        await update("payments", {
          complemento_emitido: true,
        }, { id: data.paymentId, company_id: data.companyId });
      } catch {
        // l10n_mx_edi might not be installed or method might differ
      }
    }

    return { success: true, odooPaymentId, complementoTriggered };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Error al crear pago en Odoo",
    };
  }
}

// ── Write-back: Create bank statement lines from Fintoc movements ──

/**
 * Push Fintoc bank movements to Odoo as account.bank.statement.line records.
 * This enables Odoo's native bank reconciliation to match payments with invoices.
 */
export async function pushBankStatementsToOdoo(data: BankStatementData): Promise<BankStatementResult> {
  const { client, error } = await loadOdooClient(data.companyId);
  if (error) return { success: false, created: 0, errors: [error] };

  const errors: string[] = [];
  let created = 0;

  // Get bank journal ID
  let journalId = await getCachedId(data.companyId, "bank_journal_id");
  if (!journalId) {
    journalId = await client.findBankJournalId();
    if (!journalId) {
      return { success: false, created: 0, errors: ["No se encontro diario bancario en Odoo"] };
    }
  }

  for (const mov of data.movements) {
    try {
      // Check if already pushed
      if (mov.bankMovementId) {
        const { data: existing } = await query("odoo_bank_statements", {
          match: { company_id: data.companyId, bank_movement_id: mov.bankMovementId },
          single: true,
        }).catch(() => ({ data: null }));
        if (existing) continue; // Already pushed
      }

      // Create statement line in Odoo
      const lineData: Record<string, unknown> = {
        date: mov.date,
        payment_ref: mov.paymentRef,
        amount: mov.amount, // negative = outbound, positive = inbound
        journal_id: journalId,
      };
      if (mov.partnerOdooId) lineData.partner_id = mov.partnerOdooId;

      const odooLineId = await client.create("account.bank.statement.line", lineData);

      // Record in local DB
      await insert("odoo_bank_statements", {
        company_id: data.companyId,
        odoo_statement_line_id: odooLineId,
        bank_movement_id: mov.bankMovementId || null,
        payment_id: mov.paymentId || null,
        journal_id: journalId,
        partner_id: mov.partnerOdooId || null,
        date: mov.date,
        payment_ref: mov.paymentRef,
        amount: mov.amount,
        status: "pushed",
        pushed_at: new Date().toISOString(),
      });

      created++;
    } catch (e) {
      errors.push(`Movimiento ${mov.paymentRef}: ${e instanceof Error ? e.message : "error"}`);

      // Record the error
      if (mov.bankMovementId) {
        await insert("odoo_bank_statements", {
          company_id: data.companyId,
          bank_movement_id: mov.bankMovementId,
          payment_id: mov.paymentId || null,
          journal_id: journalId,
          date: mov.date,
          payment_ref: mov.paymentRef,
          amount: mov.amount,
          status: "error",
          error_message: e instanceof Error ? e.message : "error",
        }).catch(() => {});
      }
    }
  }

  return { success: errors.length === 0, created, errors };
}

// ── Write-back: Update invoice in Odoo ──

export async function writeBackInvoiceStatus(
  companyId: number,
  invoiceOdooId: number,
  action: "post" | "cancel" | "draft",
): Promise<{ success: boolean; error?: string }> {
  const { client, error } = await loadOdooClient(companyId);
  if (error) return { success: false, error };

  try {
    const methodMap = {
      post: "action_post",
      cancel: "button_cancel",
      draft: "button_draft",
    };
    await client.callAction("account.move", methodMap[action], [invoiceOdooId]);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error al actualizar factura" };
  }
}

// ── Write-back: Create vendor in Odoo ──

export async function writeBackVendorToOdoo(
  companyId: number,
  vendorData: { name: string; rfc?: string; email?: string; phone?: string; clabe?: string },
): Promise<{ success: boolean; odooId?: number; error?: string }> {
  const { client, error } = await loadOdooClient(companyId);
  if (error) return { success: false, error };

  try {
    const partnerData: Record<string, unknown> = {
      name: vendorData.name,
      supplier_rank: 1,
      company_type: "company",
    };
    if (vendorData.rfc) partnerData.vat = vendorData.rfc;
    if (vendorData.email) partnerData.email = vendorData.email;
    if (vendorData.phone) partnerData.phone = vendorData.phone;

    const odooId = await client.create("res.partner", partnerData);

    // Create bank account if CLABE provided
    if (vendorData.clabe && odooId) {
      try {
        await client.create("res.partner.bank", {
          partner_id: odooId,
          acc_number: vendorData.clabe,
        });
      } catch { /* bank account creation optional */ }
    }

    return { success: true, odooId };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error al crear proveedor" };
  }
}

// ── Write-back: Create customer in Odoo ──

export async function writeBackCustomerToOdoo(
  companyId: number,
  customerData: { name: string; rfc?: string; email?: string; phone?: string },
): Promise<{ success: boolean; odooId?: number; error?: string }> {
  const { client, error } = await loadOdooClient(companyId);
  if (error) return { success: false, error };

  try {
    const partnerData: Record<string, unknown> = {
      name: customerData.name,
      customer_rank: 1,
      company_type: "company",
    };
    if (customerData.rfc) partnerData.vat = customerData.rfc;
    if (customerData.email) partnerData.email = customerData.email;
    if (customerData.phone) partnerData.phone = customerData.phone;

    const odooId = await client.create("res.partner", partnerData);
    return { success: true, odooId };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error al crear cliente" };
  }
}

// ── Lookup: Odoo model info ──

export async function getOdooModelFields(
  companyId: number,
  model: string,
): Promise<{ success: boolean; fields?: Record<string, unknown>; error?: string }> {
  const { client, error } = await loadOdooClient(companyId);
  if (error) return { success: false, error };

  try {
    const fields = await client.fieldsGet(model, ["string", "type", "required", "relation"]);
    return { success: true, fields };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// ── Lookup: Count records in Odoo ──

export async function getOdooRecordCount(
  companyId: number,
  model: string,
  domain: unknown[][],
): Promise<{ success: boolean; count?: number; error?: string }> {
  const { client, error } = await loadOdooClient(companyId);
  if (error) return { success: false, error };

  try {
    const count = await client.searchCount(model, domain);
    return { success: true, count };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}
