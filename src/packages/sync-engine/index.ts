/**
 * Unified Sync Engine
 *
 * One abstract SyncProvider replaces both:
 *   - src/app/api/sync/route.ts   (~1000 lines of inline sync logic)
 *   - src/lib/integrations/sync-engine.ts (~500 lines)
 *
 * Each integration implements the abstract interface. The engine handles:
 *   - Concurrency locking (one sync per provider per company)
 *   - Batch upserts with retry
 *   - Sync history logging
 *   - Error aggregation
 */
import { getAdminClient } from '@/lib/supabase/admin';
import { withRetry, isRetryableError } from '@/lib/retry';
import { ApiError } from '@/lib/utils/errors';
import type { SyncResult, SyncError, SyncStatus, SyncProvider as ProviderName } from '@/packages/shared/types';

// ---------------------------------------------------------------------------
// Re-export types
// ---------------------------------------------------------------------------
export type { SyncResult, SyncError, SyncStatus };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BATCH_SIZE = 50;
const LOCK_TIMEOUT_MINUTES = 30;

// ---------------------------------------------------------------------------
// Abstract SyncProvider — each integration extends this
// ---------------------------------------------------------------------------

export interface SyncData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [entity: string]: any[];
}

export interface SyncDiff {
  [entity: string]: {
    rows: Record<string, unknown>[];
    onConflict: string;
    table: string;
  };
}

export interface SyncProviderConfig {
  companyId: string;
  lastSyncAt?: string;
}

export abstract class BaseSyncProvider<TConfig = unknown> {
  abstract readonly name: ProviderName;

  /**
   * Retrieve provider-specific config (decrypted credentials, etc.)
   */
  abstract getConfig(companyId: string): Promise<TConfig>;

  /**
   * Fetch remote data from the external service.
   */
  abstract fetch(config: TConfig, opts: SyncProviderConfig): Promise<SyncData>;

  /**
   * Transform remote data into DB-ready rows grouped by entity.
   * Returns the table name, upsert conflict key, and rows for each entity.
   */
  abstract transform(remote: SyncData, companyId: string): SyncDiff;

  /**
   * Run the full sync pipeline: lock → fetch → transform → upsert → finalize.
   */
  async run(companyId: string): Promise<SyncResult> {
    const startedAt = new Date().toISOString();
    const admin = getAdminClient();
    const errors: SyncError[] = [];
    let recordsSynced = 0;
    let recordsFailed = 0;
    const details: Record<string, number> = {};

    const syncId = await acquireSyncLock(admin, companyId, this.name);

    try {
      // Get last successful sync timestamp
      const lastSyncAt = await this.getLastSyncAt(admin, companyId);

      // Get provider config (credentials, URLs, etc.)
      const config = await this.getConfig(companyId);

      // Fetch remote data
      const remote = await withRetry(
        () => this.fetch(config, { companyId, lastSyncAt }),
        { maxRetries: 2, baseDelay: 2000, retryOn: (err) => isRetryableError(err) },
      );

      // Transform to DB rows
      const diff = this.transform(remote, companyId);

      // Upsert each entity
      for (const [entity, { rows, onConflict, table }] of Object.entries(diff)) {
        if (rows.length === 0) continue;
        const result = await batchUpsert(admin, table, rows, onConflict, errors, entity);
        recordsSynced += result.synced;
        recordsFailed += result.failed;
        details[entity] = result.synced;
      }

      const status = computeStatus(errors, recordsSynced);
      await finalizeSyncEntry(admin, syncId, companyId, this.name, status, recordsSynced, errors);

      return {
        provider: this.name,
        status,
        recordsSynced,
        recordsFailed,
        errors,
        startedAt,
        completedAt: new Date().toISOString(),
        details,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      await finalizeSyncEntry(admin, syncId, companyId, this.name, 'failed', recordsSynced, [
        { entity: 'sync', message: errorMsg, retryable: true },
      ]);
      throw err;
    }
  }

  private async getLastSyncAt(
    admin: ReturnType<typeof getAdminClient>,
    companyId: string,
  ): Promise<string | undefined> {
    const { data } = await admin
      .from('sync_history')
      .select('completed_at')
      .eq('company_id', companyId)
      .eq('provider', this.name)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();
    return data?.completed_at || undefined;
  }
}

// ---------------------------------------------------------------------------
// Concurrency Guard
// ---------------------------------------------------------------------------
async function acquireSyncLock(
  admin: ReturnType<typeof getAdminClient>,
  companyId: string,
  provider: ProviderName,
): Promise<string> {
  const { data: running } = await admin
    .from('sync_history')
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

    // Stale lock — clear it
    await admin
      .from('sync_history')
      .update({
        status: 'failed',
        error_message: 'Sync timed out (stale lock cleared)',
        completed_at: new Date().toISOString(),
      })
      .eq('id', running.id);
  }

  const { data: entry, error } = await admin
    .from('sync_history')
    .insert({ company_id: companyId, provider, status: 'running' })
    .select('id')
    .single();

  if (error || !entry) {
    throw new ApiError('INTERNAL_ERROR', `Failed to create sync entry: ${error?.message}`, 500);
  }

  return entry.id;
}

// ---------------------------------------------------------------------------
// Finalize sync entry
// ---------------------------------------------------------------------------
async function finalizeSyncEntry(
  admin: ReturnType<typeof getAdminClient>,
  syncId: string,
  companyId: string,
  provider: ProviderName,
  status: SyncStatus,
  recordsSynced: number,
  errors: SyncError[],
) {
  const completedAt = new Date().toISOString();
  try {
    await admin
      .from('sync_history')
      .update({
        status,
        records_synced: recordsSynced,
        error_message:
          errors.length > 0
            ? errors.map((e) => `${e.entity}: ${e.message}`).join('; ').slice(0, 2000)
            : null,
        completed_at: completedAt,
      })
      .eq('id', syncId);

    if (status !== 'failed') {
      await admin
        .from('integrations')
        .update({
          last_sync: completedAt,
          last_sync_at: completedAt,
          last_sync_status: status,
        })
        .eq('company_id', companyId)
        .eq('provider', provider);
    }
  } catch (err) {
    console.error(`[sync-engine] Failed to finalize sync entry ${syncId}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Batch upsert with per-chunk retry
// ---------------------------------------------------------------------------
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
      await withRetry(
        async () => {
          const { error } = await admin
            .from(table)
            .upsert(chunk, { onConflict, ignoreDuplicates: false });
          if (error) throw new Error(error.message);
        },
        { maxRetries: 2, baseDelay: 1000, retryOn: isRetryableError },
      );
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
// Provider Registry — import { getProvider } from '@/packages/sync-engine'
// ---------------------------------------------------------------------------
const registry = new Map<ProviderName, BaseSyncProvider>();

export function registerProvider(provider: BaseSyncProvider): void {
  registry.set(provider.name, provider);
}

export function getProvider(name: ProviderName): BaseSyncProvider {
  const provider = registry.get(name);
  if (!provider) {
    throw new ApiError('VALIDATION_ERROR', `Unknown sync provider: ${name}`, 400);
  }
  return provider;
}

export function listProviders(): ProviderName[] {
  return [...registry.keys()];
}
