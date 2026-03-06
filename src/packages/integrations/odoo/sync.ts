/**
 * Odoo Sync Provider
 *
 * Implements BaseSyncProvider for Odoo ERP integration.
 * Syncs vendors, customers, and invoices from Odoo via JSON-RPC.
 */
import { BaseSyncProvider, type SyncData, type SyncDiff, type SyncProviderConfig } from '@/packages/sync-engine';
import { getAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/utils/crypto';
import { ApiError } from '@/lib/utils/errors';
import {
  type OdooConfig,
  type OdooPartner,
  type OdooInvoice,
  odooAuthenticate,
  fetchOdooVendors,
  fetchOdooCustomers,
  fetchOdooInvoices,
  normalizeOdooValue,
  extractM2oName,
} from '@/lib/integrations/odoo';
import type { SyncProvider as ProviderName } from '@/packages/shared/types';

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

    // Get raw connection credentials (prefer encrypted, fall back to plaintext)
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

    // Authenticate to get uid — OdooConfig requires { url, db, uid, apiKey }
    const uid = await odooAuthenticate(creds.url, creds.database, creds.user, creds.password);

    return {
      url: creds.url,
      db: creds.database,
      uid,
      apiKey: creds.password,
    };
  }

  async fetch(config: OdooConfig, opts: SyncProviderConfig): Promise<SyncData> {
    const [vendors, customers, invoices] = await Promise.all([
      fetchOdooVendors(config, opts.lastSyncAt).catch((err) => {
        console.error('[odoo-sync] Error fetching vendors:', err);
        return [] as OdooPartner[];
      }),
      fetchOdooCustomers(config, opts.lastSyncAt).catch((err) => {
        console.error('[odoo-sync] Error fetching customers:', err);
        return [] as OdooPartner[];
      }),
      fetchOdooInvoices(config, opts.lastSyncAt).catch((err) => {
        console.error('[odoo-sync] Error fetching invoices:', err);
        return [] as OdooInvoice[];
      }),
    ]);

    return { vendors, customers, invoices };
  }

  transform(remote: SyncData, companyId: string): SyncDiff {
    const vendors = (remote.vendors as OdooPartner[])
      .filter((v) => (normalizeOdooValue(v.vat) || '').toUpperCase().length > 0)
      .map((v) => ({
        company_id: companyId,
        name: v.name,
        rfc: (normalizeOdooValue(v.vat) || '').toUpperCase(),
        email: normalizeOdooValue(v.email),
        phone: normalizeOdooValue(v.phone),
        odoo_id: String(v.id),
        synced_at: new Date().toISOString(),
      }));

    const customers = (remote.customers as OdooPartner[])
      .filter((c) => (normalizeOdooValue(c.vat) || '').toUpperCase().length > 0)
      .map((c) => ({
        company_id: companyId,
        name: c.name,
        rfc: (normalizeOdooValue(c.vat) || '').toUpperCase(),
        email: normalizeOdooValue(c.email),
        phone: normalizeOdooValue(c.phone),
        odoo_id: String(c.id),
      }));

    const invoices = (remote.invoices as OdooInvoice[]).map((inv) => ({
      company_id: companyId,
      type: inv.move_type,
      invoice_number: inv.name,
      uuid: normalizeOdooValue(inv.l10n_mx_edi_cfdi_uuid),
      invoice_date: normalizeOdooValue(inv.invoice_date),
      due_date: normalizeOdooValue(inv.invoice_date_due),
      amount_total: inv.amount_total,
      amount_residual: inv.amount_residual,
      amount_paid: inv.amount_total - inv.amount_residual,
      amount_tax: inv.amount_tax,
      payment_state: inv.payment_state,
      payment_method: normalizeOdooValue(inv.l10n_mx_edi_payment_policy),
      partner_name: extractM2oName(inv.partner_id),
      odoo_move_id: String(inv.id),
      source: 'odoo',
      sat_status: 'no_validado',
    }));

    return {
      vendors: { rows: vendors, onConflict: 'company_id,rfc', table: 'vendors' },
      customers: { rows: customers, onConflict: 'company_id,rfc', table: 'customers' },
      invoices: { rows: invoices, onConflict: 'odoo_move_id', table: 'invoices' },
    };
  }
}
