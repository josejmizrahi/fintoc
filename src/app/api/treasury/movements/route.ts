import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';
import { parsePaginationParams } from '@/lib/utils/response';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('treasury.read', async (_req, ctx) => {
    const url = new URL(_req.url);
    const { page, limit } = parsePaginationParams(url);
    const offset = (page - 1) * limit;
    const admin = getAdminClient();

    let query = admin.from('bank_movements').select('*', { count: 'exact' }).eq('company_id', ctx.company_id);

    const dateFrom = url.searchParams.get('date_from');
    if (dateFrom) query = query.gte('date', dateFrom);
    const dateTo = url.searchParams.get('date_to');
    if (dateTo) query = query.lte('date', dateTo);
    const type = url.searchParams.get('type');
    if (type) query = query.eq('type', type);
    const reconciled = url.searchParams.get('reconciled');
    if (reconciled === 'true') query = query.eq('reconciled', true);
    if (reconciled === 'false') query = query.eq('reconciled', false);

    query = query.order('date', { ascending: false }).range(offset, offset + limit - 1);
    const { data, count } = await query;

    return Response.json({ data: data || [], meta: { total: count || 0, page, limit } });
  }))(req, { params: Promise.resolve({}) });
});
