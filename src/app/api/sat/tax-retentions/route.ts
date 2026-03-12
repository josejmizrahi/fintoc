import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import * as syntage from '@/lib/integrations/syntage';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('sat.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data: integration } = await admin
      .from('integrations')
      .select('syntage_taxpayer_id')
      .eq('company_id', ctx.company_id)
      .eq('provider', 'sat')
      .single();

    if (!integration?.syntage_taxpayer_id) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado', 422);
    }

    const retentions = await syntage.getTaxRetentions(integration.syntage_taxpayer_id);
    return Response.json({ data: retentions });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
