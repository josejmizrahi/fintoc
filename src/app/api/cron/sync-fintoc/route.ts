import { getAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/utils/crypto';
import { syncFintoc } from '@/lib/integrations/sync-engine';

export async function GET(req: Request): Promise<Response> {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();
  const results: Array<{ company_id: string; status: string; records_synced?: number; error?: string }> = [];

  try {
    const { data: integrations } = await admin.from('integrations')
      .select('company_id, config_encrypted')
      .eq('provider', 'fintoc')
      .eq('status', 'valid');

    for (const integration of (integrations || [])) {
      try {
        let secretKey = process.env.FINTOC_SECRET_KEY;
        if (integration.config_encrypted) {
          try {
            secretKey = (decrypt(integration.config_encrypted) as Record<string, string>).secret_key;
          } catch { /* fallback to env */ }
        }
        if (!secretKey) continue;

        const result = await syncFintoc(integration.company_id, secretKey, { syncDays: 7 });

        results.push({
          company_id: integration.company_id,
          status: result.status,
          records_synced: result.recordsSynced,
          error: result.errors.length > 0
            ? result.errors.map(e => `${e.entity}: ${e.message}`).join('; ')
            : undefined,
        });
      } catch (err) {
        results.push({
          company_id: integration.company_id,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return Response.json({ data: { processed: results.length, results } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
