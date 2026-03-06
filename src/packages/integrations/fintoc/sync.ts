/**
 * Fintoc Sync Provider
 *
 * Implements BaseSyncProvider for Fintoc banking integration.
 * Syncs bank accounts and movements.
 */
import { BaseSyncProvider, type SyncData, type SyncDiff, type SyncProviderConfig } from '@/packages/sync-engine';
import { getAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/utils/crypto';
import { ApiError } from '@/lib/utils/errors';
import {
  type FintocAccount,
  type FintocMovement,
  getAccounts,
  getAllMovements,
  centavosToPesos,
} from '@/lib/integrations/fintoc';
import type { SyncProvider as ProviderName } from '@/packages/shared/types';

interface FintocSyncConfig {
  secretKey: string;
  syncDays: number;
}

export class FintocSyncProvider extends BaseSyncProvider<FintocSyncConfig> {
  readonly name: ProviderName = 'fintoc';

  async getConfig(companyId: string): Promise<FintocSyncConfig> {
    const admin = getAdminClient();
    let secretKey = process.env.FINTOC_SECRET_KEY;

    const { data: integration } = await admin
      .from('integrations')
      .select('config_encrypted, config')
      .eq('company_id', companyId)
      .eq('provider', 'fintoc')
      .single();

    if (integration?.config_encrypted) {
      try {
        secretKey = (decrypt(integration.config_encrypted) as Record<string, string>).secret_key;
      } catch {
        // Fall back to plaintext config
        const cfg = integration.config as Record<string, string> | null;
        if (cfg?.secretKey) secretKey = cfg.secretKey;
      }
    } else if (integration?.config) {
      const cfg = integration.config as Record<string, string>;
      if (cfg.secretKey) secretKey = cfg.secretKey;
    }

    if (!secretKey) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Fintoc no configurado', 422);
    }

    return { secretKey, syncDays: 30 };
  }

  async fetch(config: FintocSyncConfig, opts: SyncProviderConfig): Promise<SyncData> {
    const accounts = await getAccounts(config.secretKey);
    const allMovements: Array<FintocMovement & { _accountId: string }> = [];

    const since = new Date();
    since.setDate(since.getDate() - config.syncDays);

    for (const account of accounts || []) {
      const movements = await getAllMovements(
        account.id,
        { since: since.toISOString().split('T')[0] },
        config.secretKey,
      );
      for (const mov of movements || []) {
        allMovements.push({ ...mov, _accountId: account.id });
      }
    }

    return {
      accounts: accounts || [],
      movements: allMovements,
    };
  }

  transform(remote: SyncData, companyId: string): SyncDiff {
    const accounts = (remote.accounts as FintocAccount[]).map((account) => ({
      company_id: companyId,
      fintoc_account_id: account.id,
      clabe: account.number || '',
      bank_name: account.name || null,
      account_holder: account.holder_name || null,
      balance:
        account.balance?.available != null
          ? centavosToPesos(account.balance.available)
          : null,
      currency: account.currency || 'MXN',
      last_synced: new Date().toISOString(),
    }));

    const movements = (
      remote.movements as Array<FintocMovement & { _accountId: string }>
    ).map((mov) => ({
      company_id: companyId,
      account_id: mov._accountId,
      fintoc_movement_id: mov.id,
      date: mov.post_date || new Date().toISOString().split('T')[0],
      description: mov.description || null,
      amount: centavosToPesos(mov.amount),
      type: mov.type === 'credit' ? 'credit' : 'debit',
      reference_id: mov.reference_id || null,
      sender_name: mov.sender_account?.holder_name || null,
      recipient_name: mov.recipient_account?.holder_name || null,
    }));

    return {
      accounts: { rows: accounts, onConflict: 'fintoc_account_id', table: 'bank_accounts' },
      movements: { rows: movements, onConflict: 'fintoc_movement_id', table: 'bank_movements' },
    };
  }
}
