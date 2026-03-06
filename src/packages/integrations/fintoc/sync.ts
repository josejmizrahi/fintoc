/**
 * Fintoc Sync Provider — accounts only.
 * Movements are not stored; treasury and reconciliation fetch them from Fintoc API on demand.
 */
import { BaseSyncProvider, type SyncData, type SyncDiff, type SyncProviderConfig } from '@/packages/sync-engine';
import { getAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/utils/crypto';
import { ApiError } from '@/lib/utils/errors';
import {
  type FintocAccount,
  getAccounts,
  centavosToPesos,
} from '@/lib/integrations/fintoc';
import type { SyncProvider as ProviderName } from '@/packages/shared/types';

interface FintocSyncConfig {
  secretKey: string;
  linkToken?: string;
}

export class FintocSyncProvider extends BaseSyncProvider<FintocSyncConfig> {
  readonly name: ProviderName = 'fintoc';

  async getConfig(companyId: string): Promise<FintocSyncConfig> {
    const admin = getAdminClient();
    let secretKey = process.env.FINTOC_SECRET_KEY;
    let linkToken: string | undefined;

    const { data: integration } = await admin
      .from('integrations')
      .select('config_encrypted, config')
      .eq('company_id', companyId)
      .eq('provider', 'fintoc')
      .single();

    if (integration?.config_encrypted) {
      try {
        const dec = decrypt(integration.config_encrypted) as Record<string, string>;
        secretKey = dec.secret_key ?? secretKey;
        linkToken = dec.linkToken ?? dec.link_token;
      } catch {
        const cfg = integration.config as Record<string, string> | null;
        if (cfg?.secretKey) secretKey = cfg.secretKey;
        if (cfg?.linkToken) linkToken = cfg.linkToken;
      }
    } else if (integration?.config) {
      const cfg = integration.config as Record<string, string>;
      if (cfg.secretKey) secretKey = cfg.secretKey;
      if (cfg.linkToken) linkToken = cfg.linkToken;
    }

    if (!secretKey) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Fintoc no configurado', 422);
    }

    return { secretKey, linkToken };
  }

  async fetch(config: FintocSyncConfig, _opts: SyncProviderConfig): Promise<SyncData> {
    const accounts = await getAccounts(config.secretKey, config.linkToken ? { link_token: config.linkToken } : undefined);
    return { accounts: accounts || [] };
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

    return {
      accounts: { rows: accounts, onConflict: 'fintoc_account_id', table: 'bank_accounts' },
    };
  }
}
