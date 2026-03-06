/**
 * Integration Config — separates settings from credentials
 *
 * Settings (public): URLs, database names, RFC, environment
 * Credentials (encrypted): passwords, API keys, secret keys, tokens
 */
import { getAdminClient } from '@/lib/supabase/admin';
import { encrypt, decrypt } from '@/lib/utils/crypto';
import { ApiError } from '@/lib/utils/errors';
import type { SyncProvider } from '@/packages/shared/types';

export interface IntegrationSettings {
  /** Public config — safe for UI to read */
  settings: Record<string, unknown>;
  /** Encrypted secrets — server-only */
  credentials: Record<string, unknown>;
}

/**
 * Get the public settings for an integration (safe for UI).
 * Never returns credentials.
 */
export async function getIntegrationSettings(
  companyId: string,
  provider: SyncProvider,
): Promise<Record<string, unknown> | null> {
  const admin = getAdminClient();
  const { data } = await admin
    .from('integrations')
    .select('config, status, last_sync, last_sync_at, last_sync_status')
    .eq('company_id', companyId)
    .eq('provider', provider)
    .single();

  if (!data) return null;

  // Return only public fields — filter out any secrets that may have leaked into config
  const config = (data.config as Record<string, unknown>) || {};
  const { password, secret_key, api_key, apiKey, secretKey, ...publicConfig } = config;
  void password; void secret_key; void api_key; void apiKey; void secretKey;

  return {
    ...publicConfig,
    status: data.status,
    lastSync: data.last_sync_at || data.last_sync,
    lastSyncStatus: data.last_sync_status,
  };
}

/**
 * Get decrypted credentials for server-side use only.
 */
export async function getIntegrationCredentials(
  companyId: string,
  provider: SyncProvider,
): Promise<Record<string, unknown>> {
  const admin = getAdminClient();
  const { data } = await admin
    .from('integrations')
    .select('config_encrypted')
    .eq('company_id', companyId)
    .eq('provider', provider)
    .single();

  if (!data?.config_encrypted) {
    throw new ApiError(
      'INTEGRATION_NOT_CONFIGURED',
      `${provider} no configurado para esta empresa`,
      422,
    );
  }

  return decrypt(data.config_encrypted);
}

/**
 * Save integration config — separating settings from credentials.
 * Settings go to `config` (JSON), credentials go to `config_encrypted` (encrypted).
 */
export async function saveIntegrationConfig(
  companyId: string,
  provider: SyncProvider,
  settings: Record<string, unknown>,
  credentials: Record<string, unknown>,
): Promise<void> {
  const admin = getAdminClient();
  const encryptedCredentials = encrypt(credentials);

  await admin
    .from('integrations')
    .upsert(
      {
        company_id: companyId,
        provider,
        config: settings,
        config_encrypted: encryptedCredentials,
        status: 'connected',
        is_connected: true,
      },
      { onConflict: 'company_id,provider' },
    );
}
