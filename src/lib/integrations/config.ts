import { getAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/utils/crypto';
import { ApiError } from '@/lib/utils/errors';
import { withRetry, isRetryableError } from '@/lib/retry';
import * as odoo from './odoo';
import * as syntage from './syntage';
import type { OdooConfig, OdooPartner } from './odoo';

// ---------------------------------------------------------------------------
// Types
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

export interface SatSyncResult extends SyncResult {
  extractions: Array<{
    extractor: syntage.Extractor;
    extractionId: string;
    status: syntage.ExtractionStatus;
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_SIZE = 50;
const LOCK_TIMEOUT_MINUTES = 30;
const CACHE_TTL_MS = 60 * 60 * 1000;
const RETRY_OPTS = {
  maxRetries: 2,
  baseDelay: 2000,
  maxDelay: 15_000,
  retryOn: (err: unknown) => isRetryableError(err),
  onRetry: (err: unknown, attempt: number, delay: number) => {
    console.warn(`[sync] Retry #${attempt} in ${delay}ms:`, err instanceof Error ? err.message : err);
  },
};

// ---------------------------------------------------------------------------
// Config Helpers
// ---------------------------------------------------------------------------

export async function getOdooConfigForCompany(companyId: string): Promise<OdooConfig> {
  const admin = getAdminClient();
  const { data: integration } = await admin.from('integrations')
    .select('config_encrypted, config')
    .eq('company_id', companyId)
    .eq('provider', 'odoo')
    .single();

  if (!integration) {
    throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Odoo no configurado. Configura la integracion en Configuracion.', 422);
  }

  // Try encrypted config first, then fall back to plaintext
  let creds: Record<string, string> | null = null;

  if (integration.config_encrypted) {
    const decrypted = decrypt(integration.config_encrypted as string | Buffer);
    if (decrypted) {
      creds = decrypted as Record<string, string>;
    } else {
      console.warn('[config] Odoo: encrypted config exists but decryption failed, trying plaintext');
    }
  }

  if (!creds) {
    creds = integration.config as Record<string, string> | null;
  }

  if (!creds?.url) {
    throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Odoo no configurado — faltan credenciales. Reconfigura la integracion.', 422);
  }

  const uid = await odoo.odooAuthenticate(creds.url, creds.database, creds.user, creds.password);

  return { url: creds.url, db: creds.database, uid, apiKey: creds.password };
}

export async function getFintocConfigForCompany(companyId: string): Promise<{ secretKey: string; linkToken?: string }> {
  const admin = getAdminClient();
  let secretKey = process.env.FINTOC_SECRET_KEY;
  let linkToken: string | undefined;

  const { data: integration } = await admin.from('integrations')
    .select('config_encrypted, config')
    .eq('company_id', companyId)
    .eq('provider', 'fintoc')
    .single();

  if (integration?.config_encrypted) {
    const dec = decrypt(integration.config_encrypted as string | Buffer) as Record<string, string> | null;
    if (dec) {
      secretKey = dec.secret_key ?? secretKey;
      linkToken = dec.linkToken ?? dec.link_token;
    } else {
      console.warn('[config] Fintoc: encrypted config exists but decryption failed, trying plaintext');
    }
  }
  if (!secretKey && integration?.config) {
    const cfg = integration.config as Record<string, string>;
    secretKey = cfg.secretKey ?? secretKey;
    linkToken = cfg.linkToken ?? cfg.link_token ?? linkToken;
  }

  if (!secretKey) {
    throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Fintoc no configurado — falta Secret Key. Reconfigura la integracion.', 422);
  }

  return { secretKey, linkToken };
}

export async function getFintocKeyForCompany(companyId: string): Promise<string> {
  const cfg = await getFintocConfigForCompany(companyId);
  return cfg.secretKey;
}

export async function getSyntageTaxpayerForCompany(companyId: string): Promise<string> {
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

// ---------------------------------------------------------------------------
// Vendor / Customer Cache (TTL refresh from Odoo)
// ---------------------------------------------------------------------------

export async function getVendor(companyId: string, vendorId: string): Promise<Record<string, unknown> | null> {
  const admin = getAdminClient();
  const { data: row } = await admin.from('vendors')
    .select('*')
    .eq('company_id', companyId)
    .eq('id', vendorId)
    .single();

  if (!row) return null;

  const syncedAt = row.synced_at ? new Date(row.synced_at).getTime() : 0;
  if (Date.now() - syncedAt < CACHE_TTL_MS) return row as Record<string, unknown>;

  const odooId = row.odoo_id != null ? Number(row.odoo_id) : NaN;
  if (Number.isNaN(odooId)) return row as Record<string, unknown>;

  try {
    const config = await getOdooConfigForCompany(companyId);
    const partner = await odoo.fetchOdooPartnerById(config, odooId);
    if (!partner) return row as Record<string, unknown>;

    const rfc = (odoo.normalizeOdooValue(partner.vat) || '').toUpperCase();
    if (!rfc) return row as Record<string, unknown>;

    const update = {
      name: partner.name,
      email: odoo.normalizeOdooValue(partner.email),
      phone: odoo.normalizeOdooValue(partner.phone),
      odoo_id: String(partner.id),
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await admin.from('vendors').update(update).eq('id', vendorId);
    return { ...row, ...update } as Record<string, unknown>;
  } catch {
    return row as Record<string, unknown>;
  }
}

export async function getCustomer(companyId: string, customerId: string): Promise<Record<string, unknown> | null> {
  const admin = getAdminClient();
  const { data: row } = await admin.from('customers')
    .select('*')
    .eq('company_id', companyId)
    .eq('id', customerId)
    .single();

  if (!row) return null;

  const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
  if (Date.now() - updatedAt < CACHE_TTL_MS) return row as Record<string, unknown>;

  const odooId = row.odoo_id != null ? Number(row.odoo_id) : NaN;
  if (Number.isNaN(odooId)) return row as Record<string, unknown>;

  try {
    const config = await getOdooConfigForCompany(companyId);
    const partner = await odoo.fetchOdooPartnerById(config, odooId);
    if (!partner) return row as Record<string, unknown>;

    const rfc = (odoo.normalizeOdooValue(partner.vat) || '').toUpperCase();
    if (!rfc) return row as Record<string, unknown>;

    const update = {
      name: partner.name,
      email: odoo.normalizeOdooValue(partner.email),
      phone: odoo.normalizeOdooValue(partner.phone),
      odoo_id: String(partner.id),
      updated_at: new Date().toISOString(),
    };
    await admin.from('customers').update(update).eq('id', customerId);
    return { ...row, ...update } as Record<string, unknown>;
  } catch {
    return row as Record<string, unknown>;
  }
}

// ---------------------------------------------------------------------------
// Concurrency Guard
// ---------------------------------------------------------------------------

async function acquireSyncLock(
  admin: ReturnType<typeof getAdminClient>,
  companyId: string,
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

    console.warn(`[sync] Stale lock detected for ${provider}/${companyId}, clearing`);
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

async function finalizeSyncEntry(
  admin: ReturnType<typeof getAdminClient>,
  syncId: string,
  companyId: string,
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
    console.error(`[sync] Failed to finalize sync entry ${syncId}:`, err);
  }
}

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
        const { error } = await admin.from(table).upsert(chunk as Record<string, unknown>[], {
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
// Smart Partner Upsert — link manual records, full upsert for Odoo records
// ---------------------------------------------------------------------------

async function smartPartnerUpsert(
  admin: ReturnType<typeof getAdminClient>,
  table: 'vendors' | 'customers',
  rows: Record<string, unknown>[],
  companyId: number,
  errors: SyncError[],
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;

  // Get existing records by RFC with their source
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

  const toLink: { id: number; odoo_id: unknown; name: unknown }[] = [];
  const toUpsert: Record<string, unknown>[] = [];

  for (const row of rows) {
    const rfc = row.rfc as string;
    const match = existingByRfc.get(rfc);

    if (match && match.source === 'manual') {
      // Link only — preserve app-specific data (CLABE, EFOS, etc.)
      toLink.push({ id: match.id, odoo_id: row.odoo_id, name: row.name });
    } else {
      toUpsert.push(row);
    }
  }

  // Phase 1: Link manual records
  for (const item of toLink) {
    try {
      const { error } = await admin
        .from(table)
        .update({ odoo_id: item.odoo_id, name: item.name, source: 'odoo', synced_at: new Date().toISOString() })
        .eq('id', item.id);
      if (error) throw new Error(error.message);
      synced++;
    } catch (err) {
      errors.push({ entity: table, message: err instanceof Error ? err.message : `Error linking ${table}`, retryable: isRetryableError(err) });
      failed++;
    }
  }

  // Phase 2: Full upsert for new/odoo records
  if (toUpsert.length > 0) {
    const r = await batchUpsert(admin, table, toUpsert, 'company_id,rfc', errors, table);
    synced += r.synced;
    failed += r.failed;
  }

  return { synced, failed };
}

// ---------------------------------------------------------------------------
// Odoo Partner Sync (used by /api/sync/odoo/partners)
// ---------------------------------------------------------------------------

export async function syncOdooPartners(companyId: string): Promise<{ vendors: number; customers: number; errors: string[] }> {
  const admin = getAdminClient();
  const errors: string[] = [];
  let vendorsSynced = 0;
  let customersSynced = 0;

  const config = await getOdooConfigForCompany(companyId);

  const vendorRows: Record<string, unknown>[] = [];
  const customerRows: Record<string, unknown>[] = [];
  const cid = Number(companyId);

  try {
    const [vendors, customers] = await Promise.all([
      odoo.fetchOdooVendors(config).catch((err) => {
        errors.push(err instanceof Error ? err.message : 'Error fetching vendors');
        return [] as OdooPartner[];
      }),
      odoo.fetchOdooCustomers(config).catch((err) => {
        errors.push(err instanceof Error ? err.message : 'Error fetching customers');
        return [] as OdooPartner[];
      }),
    ]);

    const vendorByRfc = new Map<string, Record<string, unknown>>();
    for (const v of vendors) {
      const rfc = (odoo.normalizeOdooValue(v.vat) || '').toUpperCase();
      if (rfc.length === 0) continue;
      vendorByRfc.set(`${cid}:${rfc}`, {
        company_id: cid,
        name: v.name,
        rfc,
        email: odoo.normalizeOdooValue(v.email),
        phone: odoo.normalizeOdooValue(v.phone),
        odoo_id: String(v.id),
        synced_at: new Date().toISOString(),
        source: 'odoo',
      });
    }
    vendorRows.push(...vendorByRfc.values());

    const customerByRfc = new Map<string, Record<string, unknown>>();
    for (const c of customers) {
      const rfc = (odoo.normalizeOdooValue(c.vat) || '').toUpperCase();
      if (rfc.length === 0) continue;
      customerByRfc.set(`${cid}:${rfc}`, {
        company_id: cid,
        name: c.name,
        rfc,
        email: odoo.normalizeOdooValue(c.email),
        phone: odoo.normalizeOdooValue(c.phone),
        odoo_id: String(c.id),
        source: 'odoo',
      });
    }
    customerRows.push(...customerByRfc.values());

    const syncErrors: SyncError[] = [];
    if (vendorRows.length > 0) {
      const r = await smartPartnerUpsert(admin, 'vendors', vendorRows, cid, syncErrors);
      vendorsSynced = r.synced;
      if (r.failed > 0) errors.push(...syncErrors.map((e) => e.message));
    }
    if (customerRows.length > 0) {
      const r = await smartPartnerUpsert(admin, 'customers', customerRows, cid, syncErrors);
      customersSynced = r.synced;
      if (r.failed > 0) errors.push(...syncErrors.map((e) => e.message));
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Unknown error');
  }

  return { vendors: vendorsSynced, customers: customersSynced, errors };
}

// ---------------------------------------------------------------------------
// SAT Sync
// ---------------------------------------------------------------------------

export async function syncSat(
  companyId: string,
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
    'invoice' as syntage.Extractor,
    'tax_status' as syntage.Extractor,
    'tax_compliance' as syntage.Extractor,
  ];

  const syncId = await acquireSyncLock(admin, companyId, 'syntage');

  try {
    for (const extractor of extractors) {
      try {
        const extraction = await withRetry(
          () => syntage.createExtraction(taxpayerId, extractor, {
            date_from: options?.dateFrom,
            date_to: options?.dateTo,
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
    await finalizeSyncEntry(admin, syncId, companyId, 'syntage', status, recordsSynced, errors);
    return { provider: 'syntage', status, recordsSynced, recordsFailed, errors, startedAt, completedAt: new Date().toISOString(), details, extractions: extractionResults };
  } catch (err) {
    await finalizeSyncEntry(admin, syncId, companyId, 'syntage', 'failed', recordsSynced, [
      { entity: 'sync', message: err instanceof Error ? err.message : 'Unknown error', retryable: true },
    ]);
    throw err;
  }
}
