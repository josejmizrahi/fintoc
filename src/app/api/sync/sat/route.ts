import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import * as syntage from '@/lib/integrations/syntage';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('sync.execute', async (_req, ctx) => {
    const admin = getAdminClient();

    const { data: integration } = await admin.from('integrations').select('syntage_taxpayer_id')
      .eq('company_id', ctx.company_id).eq('provider', 'syntage').single();

    if (!integration?.syntage_taxpayer_id) throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado', 422);

    const extraction = (await syntage.createExtraction(
      integration.syntage_taxpayer_id, 'invoice', {}
    )) as { id: string };

    await admin.from('syntage_extractions').insert({
      company_id: ctx.company_id, syntage_extraction_id: extraction.id, extractor: 'invoice', status: 'pending',
    });

    return Response.json({ data: { extraction_id: extraction.id, status: 'pending' } });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'batch' });
