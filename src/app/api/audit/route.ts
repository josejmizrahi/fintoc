import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';
import { parsePaginationParams } from '@/lib/utils/response';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('audit.read', async (_req, ctx) => {
    const url = new URL(_req.url);
    const { page, limit } = parsePaginationParams(url);
    const offset = (page - 1) * limit;
    const admin = getAdminClient();

    let query = admin.from('audit_log').select('*', { count: 'exact' }).eq('company_id', ctx.company_id);

    const entityType = url.searchParams.get('entity_type');
    if (entityType) query = query.eq('entity_type', entityType);
    const entityId = url.searchParams.get('entity_id');
    if (entityId) query = query.eq('entity_id', entityId);
    const action = url.searchParams.get('action');
    if (action) query = query.eq('action', action);
    const userId = url.searchParams.get('user_id');
    if (userId) query = query.eq('user_id', userId);
    const dateFrom = url.searchParams.get('date_from');
    if (dateFrom) query = query.gte('created_at', dateFrom);
    const dateTo = url.searchParams.get('date_to');
    if (dateTo) query = query.lte('created_at', dateTo);

    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    const { data, count } = await query;

    return Response.json({ data: data || [], meta: { total: count || 0, page, limit } });
  }))(req, { params: Promise.resolve({}) });
});
