import { getAdminClient } from '@/lib/supabase/admin';
import { syncSat } from '@/lib/integrations/sync-engine';
import { verifyCronSecret } from '@/lib/middleware/cron-auth';

interface CronResult {
  company_id: string;
  status: string;
  extractions?: unknown[];
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
      .select('company_id, syntage_taxpayer_id')
      .eq('provider', 'sat')
      .eq('is_connected', true)
      .not('syntage_taxpayer_id', 'is', null);

    for (const integration of (integrations || [])) {
      if (!integration.syntage_taxpayer_id) {
        results.push({
          company_id: integration.company_id,
          status: 'skipped',
          skipped: true,
          error: 'No taxpayer ID configured',
        });
        continue;
      }

      try {
        const result = await syncSat(integration.company_id, integration.syntage_taxpayer_id);
        results.push({
          company_id: integration.company_id,
          status: result.status,
          extractions: result.extractions,
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
