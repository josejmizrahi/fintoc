import { getAdminClient } from '@/lib/supabase/admin';
import * as syntage from '@/lib/integrations/syntage';

export async function GET(req: Request): Promise<Response> {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();
  const results: Array<{ company_id: string; status: string; error?: string }> = [];

  try {
    const { data: integrations } = await admin.from('integrations')
      .select('company_id, syntage_taxpayer_id')
      .eq('provider', 'syntage')
      .eq('status', 'valid')
      .not('syntage_taxpayer_id', 'is', null);

    for (const integration of (integrations || [])) {
      try {
        const extraction = (await syntage.createExtraction(
          integration.syntage_taxpayer_id!, 'invoice', {}
        )) as { id: string };

        await admin.from('syntage_extractions').insert({
          company_id: integration.company_id,
          syntage_extraction_id: extraction.id,
          extractor: 'invoice',
          status: 'pending',
        });

        await admin.from('integrations').update({ last_sync: new Date().toISOString() })
          .eq('company_id', integration.company_id).eq('provider', 'syntage');

        results.push({ company_id: integration.company_id, status: 'extraction_created' });
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
