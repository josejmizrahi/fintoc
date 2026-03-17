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
      .eq('provider', 'sat')
      .single();

    if (!integration?.syntage_taxpayer_id) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado', 422);
    }

    const params: syntage.InvoiceQueryParams = {};
    const type = url.searchParams.get('type');
    if (type) params.type = type as 'issued' | 'received';
    const dateFrom = url.searchParams.get('dateFrom') || url.searchParams.get('date_from');
    if (dateFrom) params.date_from = dateFrom;
    const dateTo = url.searchParams.get('dateTo') || url.searchParams.get('date_to');
    if (dateTo) params.date_to = dateTo;
    const uuids = url.searchParams.getAll('uuid');
    if (uuids.length > 0) params.uuid = uuids;
    const page = url.searchParams.get('page');
    if (page && !isNaN(parseInt(page, 10))) params.page = parseInt(page, 10);
    const limit = url.searchParams.get('limit');
    if (limit && !isNaN(parseInt(limit, 10))) params.itemsPerPage = parseInt(limit, 10);
    const status = url.searchParams.get('status');
    if (status) params.status = status as 'Vigente' | 'Cancelado';

    const invoices = await syntage.getInvoices(integration.syntage_taxpayer_id, params);

    return Response.json({ data: invoices });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
