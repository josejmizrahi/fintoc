import { getAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/utils/crypto';
import { ApiError } from '@/lib/utils/errors';
import * as odoo from './odoo';
import * as fintoc from './fintoc';
import * as syntage from './syntage';
import type { OdooConfig, OdooPartner, OdooInvoice } from './odoo';
import type { FintocAccount, FintocMovement } from './fintoc';

// ---------------------------------------------------------------------------
// Sync Engine — Centralized sync logic for all integrations
// Eliminates duplication between manual sync and cron sync routes.
// ---------------------------------------------------------------------------

export type SyncProvider = 'odoo' | 'fintoc' | 'syntage';
export type SyncStatus = 'running' | 'completed' | 'partial' | 'failed';

export interface SyncResult {
  provider: SyncProvider;
  status: SyncStatus;
  recordsSynced: number;
  recordsFailed: number;
  errors: SyncError[];
  startedAt: string;
  completedAt: string;
  details: Record<string, number>;
}

export interface SyncError {
  entity: string;
  entityId?: string;
  message: string;
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// Odoo Sync
// ---------------------------------------------------------------------------
export async function syncOdoo(companyId: string, config: OdooConfig): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const admin = getAdminClient();
  const errors: SyncError[] = [];
  let recordsSynced = 0;
  let recordsFailed = 0;
  const details: Record<string, number> = { vendors: 0, customers: 0, invoices: 0 };

  // Get the last successful sync time for incremental sync
  const { data: lastSync } = await admin.from('sync_history')
    .select('completed_at')
    .eq('company_id', companyId)
    .eq('provider', 'odoo')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();

  const lastSyncAt = lastSync?.completed_at || undefined;

  // Create sync history entry
  const { data: syncEntry } = await admin.from('sync_history').insert({
    company_id: companyId, provider: 'odoo', status: 'running',
  }).select('id').single();

  try {
    // --- Sync vendors ---
    try {
      const vendors = await odoo.fetchOdooVendors(config, lastSyncAt);
      const vendorUpserts = vendors
        .filter((v: OdooPartner) => {
          const rfc = (odoo.normalizeOdooValue(v.vat) || '').toUpperCase();
          return rfc.length > 0;
        })
        .map((v: OdooPartner) => ({
          company_id: companyId,
          name: v.name,
          rfc: (odoo.normalizeOdooValue(v.vat) || '').toUpperCase(),
          email: odoo.normalizeOdooValue(v.email),
          phone: odoo.normalizeOdooValue(v.phone),
          odoo_id: String(v.id),
          synced_at: new Date().toISOString(),
        }));

      if (vendorUpserts.length > 0) {
        // Batch upsert in chunks of 50
        for (let i = 0; i < vendorUpserts.length; i += 50) {
          const chunk = vendorUpserts.slice(i, i + 50);
          const { error } = await admin.from('vendors').upsert(chunk, { onConflict: 'company_id,rfc' });
          if (error) {
            errors.push({ entity: 'vendors', message: error.message, retryable: true });
            recordsFailed += chunk.length;
          } else {
            recordsSynced += chunk.length;
            details.vendors += chunk.length;
          }
        }
      }
    } catch (err) {
      errors.push({
        entity: 'vendors',
        message: err instanceof Error ? err.message : 'Error syncing vendors',
        retryable: !(err instanceof ApiError && err.status < 500),
      });
    }

    // --- Sync customers ---
    try {
      const customers = await odoo.fetchOdooCustomers(config, lastSyncAt);
      const customerUpserts = customers
        .filter((c: OdooPartner) => {
          const rfc = (odoo.normalizeOdooValue(c.vat) || '').toUpperCase();
          return rfc.length > 0;
        })
        .map((c: OdooPartner) => ({
          company_id: companyId,
          name: c.name,
          rfc: (odoo.normalizeOdooValue(c.vat) || '').toUpperCase(),
          email: odoo.normalizeOdooValue(c.email),
          phone: odoo.normalizeOdooValue(c.phone),
          odoo_id: String(c.id),
        }));

      if (customerUpserts.length > 0) {
        for (let i = 0; i < customerUpserts.length; i += 50) {
          const chunk = customerUpserts.slice(i, i + 50);
          const { error } = await admin.from('customers').upsert(chunk, { onConflict: 'company_id,rfc' });
          if (error) {
            errors.push({ entity: 'customers', message: error.message, retryable: true });
            recordsFailed += chunk.length;
          } else {
            recordsSynced += chunk.length;
            details.customers += chunk.length;
          }
        }
      }
    } catch (err) {
      errors.push({
        entity: 'customers',
        message: err instanceof Error ? err.message : 'Error syncing customers',
        retryable: !(err instanceof ApiError && err.status < 500),
      });
    }

    // --- Sync invoices (including credit notes) ---
    try {
      const invoices = await odoo.fetchOdooInvoices(config, lastSyncAt);
      const invoiceUpserts = invoices.map((inv: OdooInvoice) => ({
        company_id: companyId,
        type: inv.move_type,
        invoice_number: inv.name,
        uuid: odoo.normalizeOdooValue(inv.l10n_mx_edi_cfdi_uuid),
        invoice_date: odoo.normalizeOdooValue(inv.invoice_date),
        due_date: odoo.normalizeOdooValue(inv.invoice_date_due),
        amount_total: inv.amount_total,
        amount_residual: inv.amount_residual,
        amount_paid: inv.amount_total - inv.amount_residual,
        amount_tax: inv.amount_tax,
        payment_state: inv.payment_state,
        payment_method: odoo.normalizeOdooValue(inv.l10n_mx_edi_payment_policy),
        partner_name: odoo.extractM2oName(inv.partner_id),
        odoo_move_id: String(inv.id),
        source: 'odoo',
        sat_status: 'no_validado',
      }));

      if (invoiceUpserts.length > 0) {
        for (let i = 0; i < invoiceUpserts.length; i += 50) {
          const chunk = invoiceUpserts.slice(i, i + 50);
          const { error } = await admin.from('invoices').upsert(chunk, {
            onConflict: 'odoo_move_id',
            ignoreDuplicates: false,
          });
          if (error) {
            errors.push({ entity: 'invoices', message: error.message, retryable: true });
            recordsFailed += chunk.length;
          } else {
            recordsSynced += chunk.length;
            details.invoices += chunk.length;
          }
        }
      }
    } catch (err) {
      errors.push({
        entity: 'invoices',
        message: err instanceof Error ? err.message : 'Error syncing invoices',
        retryable: !(err instanceof ApiError && err.status < 500),
      });
    }

    const status: SyncStatus = errors.length === 0 ? 'completed'
      : recordsSynced > 0 ? 'partial' : 'failed';

    const completedAt = new Date().toISOString();

    if (syncEntry?.id) {
      await admin.from('sync_history').update({
        status,
        records_synced: recordsSynced,
        error_message: errors.length > 0 ? errors.map(e => `${e.entity}: ${e.message}`).join('; ') : null,
        completed_at: completedAt,
      }).eq('id', syncEntry.id);
    }

    await admin.from('integrations').update({ last_sync: completedAt })
      .eq('company_id', companyId).eq('provider', 'odoo');

    return { provider: 'odoo', status, recordsSynced, recordsFailed, errors, startedAt, completedAt, details };
  } catch (err) {
    const completedAt = new Date().toISOString();
    if (syncEntry?.id) {
      await admin.from('sync_history').update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unknown error',
        completed_at: completedAt,
      }).eq('id', syncEntry.id);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Fintoc Sync
// ---------------------------------------------------------------------------
export async function syncFintoc(
  companyId: string,
  secretKey: string,
  options?: { syncDays?: number }
): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const admin = getAdminClient();
  const errors: SyncError[] = [];
  let recordsSynced = 0;
  let recordsFailed = 0;
  const details: Record<string, number> = { accounts: 0, movements: 0 };
  const syncDays = options?.syncDays || 30;

  const { data: syncEntry } = await admin.from('sync_history').insert({
    company_id: companyId, provider: 'fintoc', status: 'running',
  }).select('id').single();

  try {
    const accounts = await fintoc.getAccounts(secretKey);

    for (const account of (accounts || [])) {
      // Upsert account
      try {
        await admin.from('bank_accounts').upsert({
          company_id: companyId,
          fintoc_account_id: account.id,
          clabe: account.number || '',
          bank_name: account.name || null,
          account_holder: account.holder_name || null,
          balance: account.balance?.available != null ? fintoc.centavosToPesos(account.balance.available) : null,
          currency: account.currency || 'MXN',
          last_synced: new Date().toISOString(),
        }, { onConflict: 'fintoc_account_id' });
        details.accounts++;
      } catch (err) {
        errors.push({
          entity: 'bank_accounts',
          entityId: account.id,
          message: err instanceof Error ? err.message : 'Error upserting account',
          retryable: true,
        });
      }

      // Fetch movements
      try {
        const since = new Date();
        since.setDate(since.getDate() - syncDays);
        const movements = await fintoc.getAllMovements(
          account.id,
          { since: since.toISOString().split('T')[0] },
          secretKey
        );

        const movementUpserts = (movements || []).map((mov: FintocMovement) => ({
          company_id: companyId,
          account_id: account.id,
          fintoc_movement_id: mov.id,
          date: mov.post_date || new Date().toISOString().split('T')[0],
          description: mov.description || null,
          amount: fintoc.centavosToPesos(mov.amount),
          type: mov.type === 'credit' ? 'credit' : 'debit',
          reference_id: mov.reference_id || null,
          sender_name: mov.sender_account?.holder_name || null,
          recipient_name: mov.recipient_account?.holder_name || null,
        }));

        if (movementUpserts.length > 0) {
          for (let i = 0; i < movementUpserts.length; i += 50) {
            const chunk = movementUpserts.slice(i, i + 50);
            const { error } = await admin.from('bank_movements').upsert(chunk, {
              onConflict: 'fintoc_movement_id',
            });
            if (error) {
              errors.push({ entity: 'movements', message: error.message, retryable: true });
              recordsFailed += chunk.length;
            } else {
              recordsSynced += chunk.length;
              details.movements += chunk.length;
            }
          }
        }
      } catch (err) {
        errors.push({
          entity: 'movements',
          entityId: account.id,
          message: err instanceof Error ? err.message : 'Error fetching movements',
          retryable: true,
        });
      }
    }

    const status: SyncStatus = errors.length === 0 ? 'completed'
      : recordsSynced > 0 ? 'partial' : 'failed';
    const completedAt = new Date().toISOString();

    if (syncEntry?.id) {
      await admin.from('sync_history').update({
        status,
        records_synced: recordsSynced,
        error_message: errors.length > 0 ? errors.map(e => `${e.entity}: ${e.message}`).join('; ') : null,
        completed_at: completedAt,
      }).eq('id', syncEntry.id);
    }

    await admin.from('integrations').update({ last_sync: completedAt })
      .eq('company_id', companyId).eq('provider', 'fintoc');

    return { provider: 'fintoc', status, recordsSynced, recordsFailed, errors, startedAt, completedAt, details };
  } catch (err) {
    const completedAt = new Date().toISOString();
    if (syncEntry?.id) {
      await admin.from('sync_history').update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unknown error',
        completed_at: completedAt,
      }).eq('id', syncEntry.id);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Syntage SAT Sync (Extraction-based)
// ---------------------------------------------------------------------------
export interface SatSyncResult extends SyncResult {
  extractions: Array<{
    extractor: syntage.Extractor;
    extractionId: string;
    status: syntage.ExtractionStatus;
  }>;
}

export async function syncSat(
  companyId: string,
  taxpayerId: string,
  options?: {
    extractors?: syntage.Extractor[];
    dateFrom?: string;
    dateTo?: string;
  }
): Promise<SatSyncResult> {
  const startedAt = new Date().toISOString();
  const admin = getAdminClient();
  const errors: SyncError[] = [];
  let recordsSynced = 0;
  let recordsFailed = 0;
  const extractionResults: SatSyncResult['extractions'] = [];
  const details: Record<string, number> = {};

  const extractors = options?.extractors || [
    'invoices' as syntage.Extractor,
    'tax_status' as syntage.Extractor,
    'tax_compliance_checks' as syntage.Extractor,
  ];

  const { data: syncEntry } = await admin.from('sync_history').insert({
    company_id: companyId, provider: 'syntage', status: 'running',
  }).select('id').single();

  try {
    for (const extractor of extractors) {
      try {
        const extraction = await syntage.createExtraction(taxpayerId, extractor, {
          dateFrom: options?.dateFrom,
          dateTo: options?.dateTo,
        });

        await admin.from('syntage_extractions').insert({
          company_id: companyId,
          syntage_extraction_id: extraction.id,
          extractor,
          status: 'pending',
        });

        extractionResults.push({
          extractor,
          extractionId: extraction.id,
          status: extraction.status || 'pending',
        });
        recordsSynced++;
        details[extractor] = 1;
      } catch (err) {
        errors.push({
          entity: extractor,
          message: err instanceof Error ? err.message : `Error creating ${extractor} extraction`,
          retryable: true,
        });
        recordsFailed++;
        extractionResults.push({
          extractor,
          extractionId: '',
          status: 'failed',
        });
      }
    }

    const status: SyncStatus = errors.length === 0 ? 'completed'
      : recordsSynced > 0 ? 'partial' : 'failed';
    const completedAt = new Date().toISOString();

    if (syncEntry?.id) {
      await admin.from('sync_history').update({
        status,
        records_synced: recordsSynced,
        error_message: errors.length > 0 ? errors.map(e => `${e.entity}: ${e.message}`).join('; ') : null,
        completed_at: completedAt,
      }).eq('id', syncEntry.id);
    }

    await admin.from('integrations').update({ last_sync: completedAt })
      .eq('company_id', companyId).eq('provider', 'syntage');

    return {
      provider: 'syntage', status, recordsSynced, recordsFailed,
      errors, startedAt, completedAt: completedAt, details,
      extractions: extractionResults,
    };
  } catch (err) {
    const completedAt = new Date().toISOString();
    if (syncEntry?.id) {
      await admin.from('sync_history').update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unknown error',
        completed_at: completedAt,
      }).eq('id', syncEntry.id);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers for sync routes
// ---------------------------------------------------------------------------
export async function getOdooConfigForCompany(companyId: string): Promise<OdooConfig> {
  const admin = getAdminClient();
  const { data: integration } = await admin.from('integrations')
    .select('config_encrypted')
    .eq('company_id', companyId)
    .eq('provider', 'odoo')
    .single();

  if (!integration?.config_encrypted) {
    throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Odoo no configurado', 422);
  }

  return decrypt(integration.config_encrypted) as unknown as OdooConfig;
}

export async function getFintocKeyForCompany(companyId: string): Promise<string> {
  const admin = getAdminClient();
  let secretKey = process.env.FINTOC_SECRET_KEY;

  const { data: integration } = await admin.from('integrations')
    .select('config_encrypted')
    .eq('company_id', companyId)
    .eq('provider', 'fintoc')
    .single();

  if (integration?.config_encrypted) {
    try {
      secretKey = (decrypt(integration.config_encrypted) as Record<string, string>).secret_key;
    } catch { /* fallback to env */ }
  }

  if (!secretKey) {
    throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Fintoc no configurado', 422);
  }

  return secretKey;
}

export async function getSyntageTaxpayerForCompany(companyId: string): Promise<string> {
  const admin = getAdminClient();
  const { data: integration } = await admin.from('integrations')
    .select('syntage_taxpayer_id')
    .eq('company_id', companyId)
    .eq('provider', 'syntage')
    .single();

  if (!integration?.syntage_taxpayer_id) {
    throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado', 422);
  }

  return integration.syntage_taxpayer_id;
}
