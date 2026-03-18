import { getAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/utils/crypto';
import { syncOdoo } from '@/lib/integrations/config';
import { verifyCronSecret } from '@/lib/middleware/cron-auth';
import type { OdooConfig } from '@/lib/integrations/odoo';

interface CronResult {
  company_id: string;
  status: string;
  records_synced?: number;
  error?: string;
  skipped?: boolean;
}

export async function GET(req: Request): Promise<Response> {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const admin = getAdminClient();
  const results: CronResult[] = [];

  try {
    const { data: integrations } = await admin.from('integrations')
      .select('company_id, config_encrypted')
      .eq('provider', 'odoo')
      .eq('is_connected', true);

    for (const integration of (integrations || [])) {
      if (!integration.config_encrypted) {
        results.push({
          company_id: integration.company_id,
          status: 'skipped',
          skipped: true,
          error: 'Missing config_encrypted',
        });
        continue;
      }

      try {
        const config = decrypt(integration.config_encrypted) as unknown as OdooConfig;
        const result = await syncOdoo(integration.company_id, config);
        results.push({
          company_id: integration.company_id,
          status: result.status,
          records_synced: result.recordsSynced,
          error: result.errors.length > 0
            ? result.errors.map(e => `${e.entity}: ${e.message}`).join('; ')
            : undefined,
        });
      } catch (err: unknown) {
        if (err instanceof Error && (err as Error & { code?: string }).code === 'SYNC_IN_PROGRESS') {
          results.push({ company_id: integration.company_id, status: 'skipped', skipped: true, error: 'Sync already running' });
        } else {
          results.push({
            company_id: integration.company_id,
            status: 'failed',
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    return Response.json({ data: { processed: results.length, results } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
