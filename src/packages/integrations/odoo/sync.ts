/**
 * Odoo Sync Provider — full sync: invoices, vendors, customers, payments, expenses, purchase orders.
 *
 * Vendors and customers use smart linking: if a manual record exists with the same RFC,
 * only the odoo_id is linked without overwriting app-specific data (CLABE, EFOS, etc.).
 */
import { BaseSyncProvider, type SyncData, type SyncDiff, type SyncProviderConfig, type SyncError } from '@/packages/sync-engine';
import { getAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/utils/crypto';
import { ApiError } from '@/lib/utils/errors';
import { withRetry, isRetryableError } from '@/lib/retry';
import {
  type OdooConfig,
  type OdooInvoice,
  type OdooPartner,
  type OdooPaymentRecord,
  type OdooExpense,
  type OdooPurchaseOrder,
  odooAuthenticate,
  fetchOdooInvoices,
  fetchOdooVendors,
  fetchOdooCustomers,
  fetchOdooPayments,
  fetchOdooExpenses,
  fetchOdooPurchaseOrders,
  normalizeOdooValue,
  extractM2oName,
  extractM2oId,
} from '@/lib/integrations/odoo';
import type { SyncProvider as ProviderName } from '@/packages/shared/types';

const LINK_BATCH_SIZE = 50;

/** Raw connection credentials as saved by onboarding */
interface OdooConnectionCreds {
  url: string;
  database: string;
  user: string;
  password: string;
}

export class OdooSyncProvider extends BaseSyncProvider<OdooConfig> {
  readonly name: ProviderName = 'odoo';

  async getConfig(companyId: string): Promise<OdooConfig> {
    const admin = getAdminClient();
    const { data: integration } = await admin
      .from('integrations')
      .select('config_encrypted, config')
      .eq('company_id', companyId)
      .eq('provider', 'odoo')
      .single();

    if (!integration) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Odoo no configurado', 422);
    }

    let creds: OdooConnectionCreds | null = null;

    if (integration.config_encrypted) {
      try {
        creds = decrypt(integration.config_encrypted) as unknown as OdooConnectionCreds;
      } catch (err) {
        console.error('[odoo-sync] Failed to decrypt config, falling back to plaintext:', err);
      }
    }

    if (!creds) {
      const cfg = integration.config as Record<string, string> | null;
      if (cfg?.url) {
        creds = {
          url: cfg.url,
          database: cfg.database || '',
          user: cfg.user || '',
          password: cfg.password || '',
        };
      }
    }

    if (!creds?.url) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Odoo no configurado', 422);
    }

    const uid = await odooAuthenticate(creds.url, creds.database, creds.user, creds.password);

    return {
      url: creds.url,
      db: creds.database,
      uid,
      apiKey: creds.password,
    };
  }

  async fetch(config: OdooConfig, opts: SyncProviderConfig): Promise<SyncData> {
    // Fetch all entities in parallel for speed
    const [invoices, vendors, customers, payments, expenses, purchaseOrders] = await Promise.all([
      fetchOdooInvoices(config, opts.lastSyncAt).catch((err) => {
        console.error('[odoo-sync] Error fetching invoices:', err);
        return [];
      }),
      fetchOdooVendors(config, opts.lastSyncAt).catch((err) => {
        console.error('[odoo-sync] Error fetching vendors:', err);
        return [];
      }),
      fetchOdooCustomers(config, opts.lastSyncAt).catch((err) => {
        console.error('[odoo-sync] Error fetching customers:', err);
        return [];
      }),
      fetchOdooPayments(config, opts.lastSyncAt).catch((err) => {
        console.error('[odoo-sync] Error fetching payments:', err);
        return [];
      }),
      fetchOdooExpenses(config, opts.lastSyncAt).catch((err) => {
        console.error('[odoo-sync] Error fetching expenses:', err);
        return [];
      }),
      fetchOdooPurchaseOrders(config, opts.lastSyncAt).catch((err) => {
        console.error('[odoo-sync] Error fetching purchase orders:', err);
        return [];
      }),
    ]);

    return {
      invoices: invoices || [],
      vendors: vendors || [],
      customers: customers || [],
      payments: payments || [],
      expenses: expenses || [],
      purchaseOrders: purchaseOrders || [],
    };
  }

  transform(remote: SyncData, companyId: string): SyncDiff {
    const cid = Number(companyId);

    return {
      invoices: {
        rows: this.transformInvoices(remote.invoices as OdooInvoice[], cid),
        onConflict: 'company_id,odoo_id',
        table: 'invoices',
      },
      vendors: {
        rows: this.transformVendors(remote.vendors as OdooPartner[], cid),
        onConflict: 'company_id,rfc',
        table: 'vendors',
        skipUpsert: true, // Handled in afterTransform for smart linking
      },
      customers: {
        rows: this.transformCustomers(remote.customers as OdooPartner[], cid),
        onConflict: 'company_id,rfc',
        table: 'customers',
        skipUpsert: true, // Handled in afterTransform for smart linking
      },
      payments: {
        rows: this.transformPayments(remote.payments as OdooPaymentRecord[], cid),
        onConflict: 'company_id,odoo_id',
        table: 'payments',
      },
      expenses: {
        rows: this.transformExpenses(remote.expenses as OdooExpense[], cid),
        onConflict: 'company_id,odoo_id',
        table: 'expenses',
      },
      purchaseOrders: {
        rows: this.transformPurchaseOrders(remote.purchaseOrders as OdooPurchaseOrder[], cid),
        onConflict: 'company_id,odoo_id',
        table: 'odoo_purchase_orders',
      },
    };
  }

  /**
   * Smart upsert for vendors and customers:
   * - If record exists with same RFC and source='manual': only link odoo_id (preserve app data)
   * - If record exists with same RFC and source='odoo': full update (Odoo is source of truth)
   * - If no record exists: insert new record
   */
  async afterTransform(
    admin: ReturnType<typeof getAdminClient>,
    companyId: string,
    diff: SyncDiff,
    errors: SyncError[],
  ): Promise<{ synced: number; failed: number; details: Record<string, number> }> {
    let synced = 0;
    let failed = 0;
    const details: Record<string, number> = {};
    const cid = Number(companyId);

    // Smart upsert vendors
    if (diff.vendors?.rows.length > 0) {
      const result = await this.smartPartnerUpsert(admin, 'vendors', diff.vendors.rows, cid, errors);
      synced += result.synced;
      failed += result.failed;
      details.vendors = result.synced;
    }

    // Smart upsert customers
    if (diff.customers?.rows.length > 0) {
      const result = await this.smartPartnerUpsert(admin, 'customers', diff.customers.rows, cid, errors);
      synced += result.synced;
      failed += result.failed;
      details.customers = result.synced;
    }

    return { synced, failed, details };
  }

  /**
   * Two-phase partner upsert:
   * Phase 1: Link existing manual records (update only odoo_id, synced_at, source)
   * Phase 2: Full upsert for new records and existing Odoo-sourced records
   */
  private async smartPartnerUpsert(
    admin: ReturnType<typeof getAdminClient>,
    table: 'vendors' | 'customers',
    rows: Record<string, unknown>[],
    companyId: number,
    errors: SyncError[],
  ): Promise<{ synced: number; failed: number }> {
    let synced = 0;
    let failed = 0;

    // Get all existing RFCs for this company with their source
    const rfcs = rows.map(r => r.rfc as string).filter(Boolean);
    const { data: existing } = await admin
      .from(table)
      .select('id, rfc, source, odoo_id')
      .eq('company_id', companyId)
      .in('rfc', rfcs);

    const existingByRfc = new Map<string, { id: number; source: string | null; odoo_id: string | null }>();
    for (const row of existing || []) {
      existingByRfc.set(row.rfc, { id: row.id, source: row.source, odoo_id: row.odoo_id });
    }

    const toLink: Record<string, unknown>[] = []; // Manual records to link
    const toUpsert: Record<string, unknown>[] = []; // New or Odoo records to full upsert

    for (const row of rows) {
      const rfc = row.rfc as string;
      const match = existingByRfc.get(rfc);

      if (match && match.source === 'manual') {
        // Phase 1: Only link — preserve manual data (CLABE, email, phone, etc.)
        toLink.push({
          id: match.id,
          odoo_id: row.odoo_id,
          synced_at: row.synced_at || new Date().toISOString(),
          source: 'odoo',
          // Also update name from Odoo (master data) but preserve clabe, efos, etc.
          name: row.name,
        });
      } else {
        // Phase 2: Full upsert (new record or already from Odoo)
        toUpsert.push(row);
      }
    }

    // Phase 1: Batch link manual records
    for (let i = 0; i < toLink.length; i += LINK_BATCH_SIZE) {
      const chunk = toLink.slice(i, i + LINK_BATCH_SIZE);
      for (const row of chunk) {
        try {
          await withRetry(
            async () => {
              const { error } = await admin
                .from(table)
                .update({
                  odoo_id: row.odoo_id,
                  synced_at: row.synced_at,
                  source: 'odoo',
                  name: row.name,
                })
                .eq('id', row.id);
              if (error) throw new Error(error.message);
            },
            { maxRetries: 1, baseDelay: 500, retryOn: isRetryableError },
          );
          synced++;
        } catch (err) {
          errors.push({
            entity: table,
            message: err instanceof Error ? err.message : `Error linking ${table}`,
            retryable: isRetryableError(err),
          });
          failed++;
        }
      }
    }

    // Phase 2: Batch upsert new/Odoo records
    for (let i = 0; i < toUpsert.length; i += LINK_BATCH_SIZE) {
      const chunk = toUpsert.slice(i, i + LINK_BATCH_SIZE);
      try {
        await withRetry(
          async () => {
            const { error } = await admin
              .from(table)
              .upsert(chunk, { onConflict: 'company_id,rfc', ignoreDuplicates: false });
            if (error) throw new Error(error.message);
          },
          { maxRetries: 2, baseDelay: 1000, retryOn: isRetryableError },
        );
        synced += chunk.length;
      } catch (err) {
        errors.push({
          entity: table,
          message: err instanceof Error ? err.message : `Error upserting ${table}`,
          retryable: isRetryableError(err),
        });
        failed += chunk.length;
      }
    }

    return { synced, failed };
  }

  private transformInvoices(invoices: OdooInvoice[], companyId: number): Record<string, unknown>[] {
    const moveTypeToAppType: Record<string, 'payable' | 'receivable'> = {
      in_invoice: 'payable',
      in_refund: 'payable',
      out_invoice: 'receivable',
      out_refund: 'receivable',
    };

    const seenUuids = new Set<string>();

    return invoices
      .filter((inv) => inv.move_type !== 'entry')
      .map((inv) => {
        let uuid = normalizeOdooValue(inv.l10n_mx_edi_cfdi_uuid);
        if (uuid) {
          const lower = uuid.toLowerCase();
          if (seenUuids.has(lower)) {
            uuid = null;
          } else {
            seenUuids.add(lower);
          }
        }
        return {
          company_id: companyId,
          type: moveTypeToAppType[inv.move_type] ?? 'payable',
          move_type: inv.move_type,
          invoice_number: inv.name,
          uuid,
          invoice_date: normalizeOdooValue(inv.invoice_date),
          due_date: normalizeOdooValue(inv.invoice_date_due),
          amount_total: inv.amount_total,
          amount_residual: inv.amount_residual,
          amount_paid: inv.amount_total - inv.amount_residual,
          amount_tax: inv.amount_tax,
          payment_state: inv.payment_state,
          payment_method: normalizeOdooValue(inv.l10n_mx_edi_payment_policy),
          partner_name: extractM2oName(inv.partner_id),
          odoo_id: inv.id,
          odoo_move_id: String(inv.id),
          odoo_cfdi_uuid: normalizeOdooValue(inv.l10n_mx_edi_cfdi_uuid),
          odoo_payment_method: normalizeOdooValue(inv.l10n_mx_edi_payment_policy),
          odoo_usage: normalizeOdooValue(inv.l10n_mx_edi_usage),
          currency: extractM2oName(inv.currency_id) ?? 'MXN',
          source: 'odoo',
          sat_status: 'no_validado',
        };
      });
  }

  private transformVendors(vendors: OdooPartner[], companyId: number): Record<string, unknown>[] {
    const byRfc = new Map<string, Record<string, unknown>>();

    for (const v of vendors) {
      const rfc = (normalizeOdooValue(v.vat) || '').toUpperCase();
      if (rfc.length === 0) continue;
      byRfc.set(`${companyId}:${rfc}`, {
        company_id: companyId,
        name: v.name,
        rfc,
        email: normalizeOdooValue(v.email),
        phone: normalizeOdooValue(v.phone),
        supplier_rank: v.supplier_rank ?? 1,
        odoo_id: String(v.id),
        synced_at: new Date().toISOString(),
        source: 'odoo',
      });
    }

    return [...byRfc.values()];
  }

  private transformCustomers(customers: OdooPartner[], companyId: number): Record<string, unknown>[] {
    const byRfc = new Map<string, Record<string, unknown>>();

    for (const c of customers) {
      const rfc = (normalizeOdooValue(c.vat) || '').toUpperCase();
      if (rfc.length === 0) continue;
      byRfc.set(`${companyId}:${rfc}`, {
        company_id: companyId,
        name: c.name,
        rfc,
        email: normalizeOdooValue(c.email),
        phone: normalizeOdooValue(c.phone),
        customer_rank: c.customer_rank ?? 1,
        odoo_id: String(c.id),
        source: 'odoo',
      });
    }

    return [...byRfc.values()];
  }

  private transformPayments(payments: OdooPaymentRecord[], companyId: number): Record<string, unknown>[] {
    const stateMap: Record<string, string> = {
      posted: 'confirmed',
      sent: 'processing',
      reconciled: 'confirmed',
    };

    return payments.map((p) => ({
      company_id: companyId,
      direction: p.payment_type === 'inbound' ? 'inbound' : 'outbound',
      status: stateMap[p.state] ?? 'draft',
      amount: p.amount,
      currency: extractM2oName(p.currency_id) ?? 'MXN',
      partner_name: extractM2oName(p.partner_id),
      reference_id: normalizeOdooValue(p.ref),
      odoo_id: p.id,
      odoo_payment_id: String(p.id),
      odoo_state: p.state,
      odoo_synced_at: new Date().toISOString(),
      reconciled_invoice_ids: p.reconciled_invoice_ids?.length > 0
        ? JSON.stringify(p.reconciled_invoice_ids)
        : '[]',
      source: 'odoo',
    }));
  }

  private transformExpenses(expenses: OdooExpense[], companyId: number): Record<string, unknown>[] {
    const stateMap: Record<string, string> = {
      reported: 'submitted',
      approved: 'approved',
      done: 'approved',
      refused: 'rejected',
    };

    return expenses.map((e) => ({
      company_id: companyId,
      employee_name: extractM2oName(e.employee_id),
      category: extractM2oName(e.product_id),
      description: normalizeOdooValue(e.description) || e.name,
      amount: e.total_amount,
      currency: extractM2oName(e.currency_id) ?? 'MXN',
      status: stateMap[e.state] ?? 'submitted',
      payment_mode: e.payment_mode,
      sheet_id: extractM2oId(e.sheet_id),
      expense_reference: normalizeOdooValue(e.reference),
      product_category: extractM2oName(e.product_id),
      odoo_id: e.id,
      source: 'odoo',
    }));
  }

  private transformPurchaseOrders(orders: OdooPurchaseOrder[], companyId: number): Record<string, unknown>[] {
    return orders.map((po) => ({
      company_id: companyId,
      odoo_id: po.id,
      name: po.name,
      partner_id: extractM2oId(po.partner_id),
      partner_name: extractM2oName(po.partner_id),
      state: po.state,
      amount_total: po.amount_total,
      amount_tax: po.amount_tax,
      currency: extractM2oName(po.currency_id) ?? 'MXN',
      date_order: normalizeOdooValue(po.date_order),
      date_planned: normalizeOdooValue(po.date_planned),
      invoice_status: po.invoice_status,
      invoice_count: po.invoice_count,
      notes: normalizeOdooValue(po.notes),
      source: 'odoo',
    }));
  }
}
