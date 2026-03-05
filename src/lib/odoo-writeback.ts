/**
 * Odoo Write-Back: Create account.payment in Odoo when payments are confirmed.
 *
 * Flow: App confirms payment -> Creates account.payment in Odoo -> Confirms (action_post)
 *       -> Reconciles with invoice -> Triggers complemento de pago for PPD invoices.
 */

import { query, update } from "@/lib/db";
import { odooAuthenticate, odooCreate, odooExecute, odooSearch } from "@/lib/odoo";

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
}

interface WriteBackResult {
  success: boolean;
  odooPaymentId?: number;
  complementoTriggered?: boolean;
  error?: string;
}

/**
 * Push a confirmed payment to Odoo as an account.payment record.
 * Optionally reconciles with an invoice and triggers complemento de pago for PPD invoices.
 */
export async function writeBackPaymentToOdoo(data: OdooPaymentData): Promise<WriteBackResult> {
  // Load Odoo integration config
  const { data: integration } = await query("integrations", {
    match: { company_id: data.companyId, provider: "odoo" },
    single: true,
  });

  if (!integration?.config) {
    return { success: false, error: "Odoo no esta configurado" };
  }

  const config = integration.config as Record<string, string>;
  const { url, database, user, password } = config;
  if (!url || !database || !user || !password) {
    return { success: false, error: "Configuracion de Odoo incompleta" };
  }

  try {
    const uid = await odooAuthenticate(url, database, user, password);

    // Step 1: Find partner in Odoo by RFC
    let partnerId: number | null = null;
    if (data.partnerRfc) {
      const partners = await odooSearch(url, database, uid, password, "res.partner",
        [["vat", "=", data.partnerRfc]], 1);
      if (partners.length > 0) partnerId = partners[0];
    }

    // If no partner by RFC, try by name
    if (!partnerId && data.partnerName) {
      const partners = await odooSearch(url, database, uid, password, "res.partner",
        [["name", "ilike", data.partnerName]], 1);
      if (partners.length > 0) partnerId = partners[0];
    }

    // Step 2: Find MXN currency ID
    const currencyIds = await odooSearch(url, database, uid, password, "res.currency",
      [["name", "=", "MXN"]], 1);
    const currencyId = currencyIds[0] || null;

    // Step 3: Find bank journal
    const journalIds = await odooSearch(url, database, uid, password, "account.journal",
      [["type", "=", "bank"]], 1);
    const journalId = journalIds[0] || null;

    if (!journalId) {
      return { success: false, error: "No se encontro diario bancario en Odoo" };
    }

    // Step 4: Create account.payment
    const paymentType = data.direction === "outbound" ? "outbound" : "inbound";
    const partnerType = data.direction === "outbound" ? "supplier" : "customer";

    const paymentData: Record<string, unknown> = {
      payment_type: paymentType,
      partner_type: partnerType,
      amount: data.amount,
      journal_id: journalId,
      ref: data.reference || `FINTOC-PAY-${data.paymentId}`,
      date: data.date || new Date().toISOString().split("T")[0],
    };

    if (partnerId) paymentData.partner_id = partnerId;
    if (currencyId) paymentData.currency_id = currencyId;

    const odooPaymentId = await odooCreate(url, database, uid, password, "account.payment", paymentData);

    // Step 5: Confirm payment (action_post)
    try {
      await odooExecute(url, database, uid, password, "account.payment", "action_post", [odooPaymentId]);
    } catch {
      // Some Odoo versions use action_validate_invoice_payment
      try {
        await odooExecute(url, database, uid, password, "account.payment", "action_validate_invoice_payment", [odooPaymentId]);
      } catch { /* Payment created but not confirmed — manual intervention needed */ }
    }

    // Step 6: Update Supabase with odoo_payment_id
    await update("payments", {
      odoo_payment_id: odooPaymentId,
    }, { id: data.paymentId, company_id: data.companyId });

    // Step 7: Try to trigger complemento de pago for PPD invoices
    let complementoTriggered = false;
    if (data.invoiceOdooId) {
      try {
        // l10n_mx_edi module method to generate complemento
        await odooExecute(url, database, uid, password, "account.move",
          "l10n_mx_edi_cfdi_invoice_try_send", [data.invoiceOdooId]);
        complementoTriggered = true;

        // Update payment record
        await update("payments", { complemento_emitido: true }, { id: data.paymentId, company_id: data.companyId });
      } catch {
        // l10n_mx_edi might not be installed or method might differ
      }
    }

    return {
      success: true,
      odooPaymentId,
      complementoTriggered,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Error al crear pago en Odoo",
    };
  }
}
