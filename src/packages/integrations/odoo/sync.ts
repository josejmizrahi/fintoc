/**
 * Odoo Sync Provider — invoices only.
 * Vendors and customers are cached on-demand via getVendor/getCustomer (sync-engine).
 */
import { BaseSyncProvider, type SyncData, type SyncDiff, type SyncProviderConfig } from '@/packages/sync-engine';
import { getAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/utils/crypto';
import { ApiError } from '@/lib/utils/errors';
import {
  type OdooConfig,
  type OdooInvoice,
  odooAuthenticate,
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
    const invoices = await fetchOdooInvoices(config, opts.lastSyncAt).catch((err) => {
      console.error('[odoo-sync] Error fetching invoices:', err);
      throw err instanceof Error ? err : new Error(String(err));
    });
    return { invoices: invoices || [] };
  }

  transform(remote: SyncData, companyId: string): SyncDiff {
    const cid = Number(companyId);
    const seenUuids = new Set<string>();

    const invoices = (remote.invoices as OdooInvoice[]).map((inv) => {
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
        company_id: cid,
        type: inv.move_type,
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
        source: 'odoo',
        sat_status: 'no_validado',
      };
    });

    return {
      invoices: { rows: invoices, onConflict: 'company_id,odoo_id', table: 'invoices' },
    };
  }
}
