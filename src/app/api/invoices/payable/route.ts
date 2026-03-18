import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';
import { parsePaginationParams } from '@/lib/utils/response';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('invoices.read', async (_req, ctx) => {
    const url = new URL(_req.url);
    const { page, limit } = parsePaginationParams(url);
    const offset = (page - 1) * limit;
    const admin = getAdminClient();

    let query = admin
      .from('invoices')
      .select('*, vendors:vendor_id(id, name, rfc)', { count: 'exact' })
      .eq('company_id', ctx.company_id)
      .eq('type', 'payable');

    const status = url.searchParams.get('status');
    if (status) query = query.eq('status', status);
    const satStatus = url.searchParams.get('sat_status');
    if (satStatus) query = query.eq('sat_status', satStatus);

    query = query.order('invoice_date', { ascending: false }).range(offset, offset + limit - 1);
    const { data, count } = await query;

    return Response.json({ data: data || [], meta: { total: count || 0, page, limit } });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
