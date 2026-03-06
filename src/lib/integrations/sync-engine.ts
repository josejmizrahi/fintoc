import { getAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/utils/crypto';
import { ApiError } from '@/lib/utils/errors';
import { withRetry, isRetryableError } from '@/lib/retry';
import * as odoo from './odoo';
import * as fintoc from './fintoc';
import * as syntage from './syntage';
import type { OdooConfig, OdooPartner, OdooInvoice } from './odoo';
import type { FintocAccount, FintocMovement } from './fintoc';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncProvider = 'odoo' | 'fintoc' | 'sat';
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
// Constants
// ---------------------------------------------------------------------------

const BATCH_SIZE = 50;
const LOCK_TIMEOUT_MINUTES = 30;
const RETRY_OPTS = {
  maxRetries: 2,
  baseDelay: 2000,
  maxDelay: 15_000,
  retryOn: (err: unknown) => isRetryableError(err),
  onRetry: (err: unknown, attempt: number, delay: number) => {
    console.warn(`[sync-engine] Retry #${attempt} in ${delay}ms:`, err instanceof Error ? err.message : err);
  },
};

// ---------------------------------------------------------------------------
// Concurrency Guard
// ---------------------------------------------------------------------------

/**
 * Acquire a sync lock by checking for any "running" sync_history entry.
 * If a recent one exists, reject. If stale (>LOCK_TIMEOUT_MINUTES), clear it.
 */
async function acquireSyncLock(
  admin: ReturnType<typeof getAdminClient>,
  companyId: number,
  provider: SyncProvider,
): Promise<string> {
  const { data: running } = await admin.from('sync_history')
    .select('id, created_at')
    .eq('company_id', companyId)
    .eq('provider', provider)
    .eq('status', 'running')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (running) {
    const createdAt = new Date(running.created_at).getTime();
    const staleThreshold = Date.now() - LOCK_TIMEOUT_MINUTES * 60 * 1000;

    if (createdAt > staleThreshold) {
      throw new ApiError(
        'SYNC_IN_PROGRESS',
        `Sync for ${provider} is already running (started ${running.created_at})`,
        409,
      );
    }

    console.warn(`[sync-engine] Stale lock detected for ${provider}/${companyId}, clearing`);
    await admin.from('sync_history').update({
      status: 'failed',
      error_message: 'Sync timed out (stale lock cleared)',
      completed_at: new Date().toISOString(),
    }).eq('id', running.id);
  }

  const { data: entry, error } = await admin.from('sync_history').insert({
    company_id: companyId, provider, status: 'running',
  }).select('id').single();

  if (error || !entry) {
    throw new ApiError('INTERNAL_ERROR', `Failed to create sync entry: ${error?.message}`, 500);
  }

  return entry.id;
}

/**
 * Finalize sync: update sync_history and integrations.last_sync.
 * Never throws — swallows DB errors so it doesn't mask the real result.
 */
async function finalizeSyncEntry(
  admin: ReturnType<typeof getAdminClient>,
  syncId: string,
  companyId: number,
  provider: SyncProvider,
  status: SyncStatus,
  recordsSynced: number,
  errors: SyncError[],
) {
  const completedAt = new Date().toISOString();
  try {
    await admin.from('sync_history').update({
      status,
      records_synced: recordsSynced,
      error_message: errors.length > 0
        ? errors.map(e => `${e.entity}: ${e.message}`).join('; ').slice(0, 2000)
        : null,
      completed_at: completedAt,
    }).eq('id', syncId);

    if (status !== 'failed') {
      await admin.from('integrations').update({ last_sync: completedAt })
        .eq('company_id', companyId).eq('provider', provider);
    }
  } catch (err) {
    console.error(`[sync-engine] Failed to finalize sync entry ${syncId}:`, err);
  }
}

/**
 * Batch upsert with per-chunk retry.
 */
async function batchUpsert(
  admin: ReturnType<typeof getAdminClient>,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  errors: SyncError[],
  entityLabel: string,
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    try {
      await withRetry(async () => {
        const { error } = await admin.from(table).upsert(chunk as any, {
          onConflict,
          ignoreDuplicates: false,
        });
        if (error) throw new Error(error.message);
      }, { maxRetries: 2, baseDelay: 1000, retryOn: isRetryableError });
      synced += chunk.length;
    } catch (err) {
      errors.push({
        entity: entityLabel,
        message: err instanceof Error ? err.message : `Error upserting ${entityLabel}`,
        retryable: isRetryableError(err),
      });
      failed += chunk.length;
    }
  }

  return { synced, failed };
}

function computeStatus(errors: SyncError[], recordsSynced: number): SyncStatus {
  if (errors.length === 0) return 'completed';
  if (recordsSynced > 0) return 'partial';
  return 'failed';
}

// ---------------------------------------------------------------------------
// Odoo Sync
// ---------------------------------------------------------------------------

export async function syncOdoo(companyId: number, config: OdooConfig): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const admin = getAdminClient();
  const errors: SyncError[] = [];
  let recordsSynced = 0;
  let recordsFailed = 0;
  const details: Record<string, number> = { vendors: 0, customers: 0, invoices: 0 };

  const syncId = await acquireSyncLock(admin, companyId, 'odoo');

  try {
    const { data: lastSync } = await admin.from('sync_history')
      .select('completed_at')
      .eq('company_id', companyId)
      .eq('provider', 'odoo')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    const lastSyncAt = lastSync?.completed_at || undefined;

    // --- Vendors ---
    try {
      const vendors = await withRetry(() => odoo.fetchOdooVendors(config, lastSyncAt), RETRY_OPTS);
      const vendorRows = vendors
        .filter((v: OdooPartner) => (odoo.normalizeOdooValue(v.vat) || '').toUpperCase().length > 0)
        .map((v: OdooPartner) => ({
          company_id: companyId,
          name: v.name,
          rfc: (odoo.normalizeOdooValue(v.vat) || '').toUpperCase(),
          email: odoo.normalizeOdooValue(v.email),
          phone: odoo.normalizeOdooValue(v.phone),
          odoo_id: v.id,
          synced_at: new Date().toISOString(),
        }));

      if (vendorRows.length > 0) {
        const r = await batchUpsert(admin, 'vendors', vendorRows, 'company_id,rfc', errors, 'vendors');
        recordsSynced += r.synced; recordsFailed += r.failed; details.vendors = r.synced;
      }
    } catch (err) {
      errors.push({ entity: 'vendors', message: err instanceof Error ? err.message : 'Error fetching vendors', retryable: isRetryableError(err) });
    }

    // --- Customers ---
    try {
      const customers = await withRetry(() => odoo.fetchOdooCustomers(config, lastSyncAt), RETRY_OPTS);
      const customerRows = customers
        .filter((c: OdooPartner) => (odoo.normalizeOdooValue(c.vat) || '').toUpperCase().length > 0)
        .map((c: OdooPartner) => ({
          company_id: companyId,
          name: c.name,
          rfc: (odoo.normalizeOdooValue(c.vat) || '').toUpperCase(),
          email: odoo.normalizeOdooValue(c.email),
          phone: odoo.normalizeOdooValue(c.phone),
          odoo_id: c.id,
        }));

      if (customerRows.length > 0) {
        const r = await batchUpsert(admin, 'customers', customerRows, 'company_id,rfc', errors, 'customers');
        recordsSynced += r.synced; recordsFailed += r.failed; details.customers = r.synced;
      }
    } catch (err) {
      errors.push({ entity: 'customers', message: err instanceof Error ? err.message : 'Error fetching customers', retryable: isRetryableError(err) });
    }

    // --- Invoices ---
    try {
      const invoices = await withRetry(() => odoo.fetchOdooInvoices(config, lastSyncAt), RETRY_OPTS);
      const invoiceRows = invoices.map((inv: OdooInvoice) => ({
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
        odoo_move_id: inv.id,
        source: 'odoo',
        sat_status: 'no_validado',
      }));

      if (invoiceRows.length > 0) {
        const r = await batchUpsert(admin, 'invoices', invoiceRows, 'odoo_move_id', errors, 'invoices');
        recordsSynced += r.synced; recordsFailed += r.failed; details.invoices = r.synced;
      }
    } catch (err) {
      errors.push({ entity: 'invoices', message: err instanceof Error ? err.message : 'Error fetching invoices', retryable: isRetryableError(err) });
    }

    const status = computeStatus(errors, recordsSynced);
    await finalizeSyncEntry(admin, syncId, companyId, 'odoo', status, recordsSynced, errors);
    return { provider: 'odoo', status, recordsSynced, recordsFailed, errors, startedAt, completedAt: new Date().toISOString(), details };
  } catch (err) {
    await finalizeSyncEntry(admin, syncId, companyId, 'odoo', 'failed', recordsSynced, [
      { entity: 'sync', message: err instanceof Error ? err.message : 'Unknown error', retryable: true },
    ]);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Fintoc Sync
// ---------------------------------------------------------------------------

export async function syncFintoc(
  companyId: number,
  secretKey: string,
  linkToken: string,
  options?: { syncDays?: number },
): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const admin = getAdminClient();
  const errors: SyncError[] = [];
  let recordsSynced = 0;
  let recordsFailed = 0;
  const details: Record<string, number> = { accounts: 0, movements: 0 };
  const syncDays = options?.syncDays || 30;

  const syncId = await acquireSyncLock(admin, companyId, 'fintoc');

  try {
    const accounts = await withRetry(() => fintoc.getAccounts(secretKey, linkToken), RETRY_OPTS);

    for (const account of (accounts || [])) {
      // Upsert account
      try {
        await withRetry(async () => {
          const { error } = await admin.from('bank_accounts').upsert({
            company_id: companyId,
            fintoc_account_id: account.id,
            clabe: account.number || '',
            bank_name: account.name || null,
            account_holder: account.holder_name || null,
            balance: account.balance?.available != null
              ? fintoc.centavosToPesos(account.balance.available) : null,
            currency: account.currency || 'MXN',
            last_synced: new Date().toISOString(),
          }, { onConflict: 'fintoc_account_id' });
          if (error) throw new Error(error.message);
        }, { maxRetries: 2, baseDelay: 1000, retryOn: isRetryableError });
        details.accounts++;
        recordsSynced++;
      } catch (err) {
        errors.push({ entity: 'bank_accounts', entityId: account.id, message: err instanceof Error ? err.message : 'Error upserting account', retryable: isRetryableError(err) });
        recordsFailed++;
      }

      // Movements
      try {
        const since = new Date();
        since.setDate(since.getDate() - syncDays);
        const movements = await withRetry(
          () => fintoc.getAllMovements(account.id, { since: since.toISOString().split('T')[0] }, secretKey, 20, linkToken),
          RETRY_OPTS,
        );

        const movementRows = (movements || []).map((mov: FintocMovement) => ({
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

        if (movementRows.length > 0) {
          const r = await batchUpsert(admin, 'bank_movements', movementRows, 'fintoc_movement_id', errors, 'movements');
          recordsSynced += r.synced; recordsFailed += r.failed; details.movements += r.synced;
        }
      } catch (err) {
        errors.push({ entity: 'movements', entityId: account.id, message: err instanceof Error ? err.message : 'Error fetching movements', retryable: true });
      }
    }

    const status = computeStatus(errors, recordsSynced);
    await finalizeSyncEntry(admin, syncId, companyId, 'fintoc', status, recordsSynced, errors);
    return { provider: 'fintoc', status, recordsSynced, recordsFailed, errors, startedAt, completedAt: new Date().toISOString(), details };
  } catch (err) {
    await finalizeSyncEntry(admin, syncId, companyId, 'fintoc', 'failed', recordsSynced, [
      { entity: 'sync', message: err instanceof Error ? err.message : 'Unknown error', retryable: true },
    ]);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Syntage SAT Sync
// ---------------------------------------------------------------------------

export interface SatSyncResult extends SyncResult {
  extractions: Array<{
    extractor: syntage.Extractor;
    extractionId: string;
    status: syntage.ExtractionStatus;
  }>;
}

export async function syncSat(
  companyId: number,
  taxpayerId: string,
  options?: { extractors?: syntage.Extractor[]; dateFrom?: string; dateTo?: string },
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

  const syncId = await acquireSyncLock(admin, companyId, 'sat');

  try {
    for (const extractor of extractors) {
      try {
        const extraction = await withRetry(
          () => syntage.createExtraction(taxpayerId, extractor, {
            dateFrom: options?.dateFrom,
            dateTo: options?.dateTo,
          }),
          RETRY_OPTS,
        );

        await admin.from('syntage_extractions').insert({
          company_id: companyId,
          syntage_extraction_id: extraction.id,
          extractor,
          status: 'pending',
        });

        extractionResults.push({ extractor, extractionId: extraction.id, status: extraction.status || 'pending' });
        recordsSynced++;
        details[extractor] = 1;
      } catch (err) {
        errors.push({ entity: extractor, message: err instanceof Error ? err.message : `Error creating ${extractor} extraction`, retryable: isRetryableError(err) });
        recordsFailed++;
        extractionResults.push({ extractor, extractionId: '', status: 'failed' });
      }
    }

    const status = computeStatus(errors, recordsSynced);
    await finalizeSyncEntry(admin, syncId, companyId, 'sat', status, recordsSynced, errors);
    return { provider: 'sat', status, recordsSynced, recordsFailed, errors, startedAt, completedAt: new Date().toISOString(), details, extractions: extractionResults };
  } catch (err) {
    await finalizeSyncEntry(admin, syncId, companyId, 'sat', 'failed', recordsSynced, [
      { entity: 'sync', message: err instanceof Error ? err.message : 'Unknown error', retryable: true },
    ]);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export async function getOdooConfigForCompany(companyId: number): Promise<OdooConfig> {
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

export async function getFintocKeyForCompany(companyId: number): Promise<{ secretKey: string; linkToken: string }> {
  const admin = getAdminClient();
  let secretKey = process.env.FINTOC_SECRET_KEY;
  let linkToken = '';

  const { data: integration } = await admin.from('integrations')
    .select('config_encrypted, config')
    .eq('company_id', companyId)
    .eq('provider', 'fintoc')
    .single();

  if (integration?.config_encrypted) {
    try {
      secretKey = (decrypt(integration.config_encrypted) as Record<string, string>).secret_key;
    } catch { /* fallback to env */ }
  }

  // Get linkToken from plaintext config (it's not sensitive)
  const config = (integration?.config || {}) as Record<string, string>;
  linkToken = config.linkToken || '';

  if (!secretKey) {
    throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Fintoc no configurado', 422);
  }
  if (!linkToken) {
    throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Fintoc link_token no configurado. Conecta tu cuenta bancaria primero.', 422);
  }

  return { secretKey, linkToken };
}

export async function getSyntageTaxpayerForCompany(companyId: number): Promise<string> {
  const admin = getAdminClient();
  const { data: integration } = await admin.from('integrations')
    .select('syntage_taxpayer_id')
    .eq('company_id', companyId)
    .eq('provider', 'sat')
    .single();

  if (!integration?.syntage_taxpayer_id) {
    throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado', 422);
  }

  return integration.syntage_taxpayer_id;
}
