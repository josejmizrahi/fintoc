import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import * as syntage from '@/lib/integrations/syntage';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('sat.read', async (_req, ctx) => {
    const url = new URL(_req.url);
    const admin = getAdminClient();

    const { data: integration } = await admin
      .from('integrations')
      .select('syntage_taxpayer_id')
      .eq('company_id', ctx.company_id)
      .eq('provider', 'syntage')
      .single();

    if (!integration?.syntage_taxpayer_id) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado', 422);
    }

    const params: syntage.InvoiceQueryParams = {};
    const type = url.searchParams.get('type');
    if (type) params.type = type as 'issued' | 'received';
    const dateFrom = url.searchParams.get('dateFrom');
    if (dateFrom) params.dateFrom = dateFrom;
    const dateTo = url.searchParams.get('dateTo');
    if (dateTo) params.dateTo = dateTo;
    const uuids = url.searchParams.getAll('uuid');
    if (uuids.length > 0) params.uuid = uuids;
    const page = url.searchParams.get('page');
    if (page) params.page = parseInt(page, 10);
    const limit = url.searchParams.get('limit');
    if (limit) params.itemsPerPage = parseInt(limit, 10);
    const status = url.searchParams.get('status');
    if (status) params.status = status as 'active' | 'cancelled';

    const invoices = await syntage.getInvoices(integration.syntage_taxpayer_id, params);

    return Response.json({ data: invoices });
  }))(req, { params: Promise.resolve({}) });
});
