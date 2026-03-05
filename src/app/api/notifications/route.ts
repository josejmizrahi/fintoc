import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { getAdminClient } from '@/lib/supabase/admin';
import { parsePaginationParams } from '@/lib/utils/response';

export const GET = createHandler(async (req) => {
  return withAuth(async (_req, ctx) => {
    const url = new URL(_req.url);
    const { page, limit } = parsePaginationParams(url);
    const offset = (page - 1) * limit;
    const admin = getAdminClient();

    let query = admin.from('notifications').select('*', { count: 'exact' })
      .eq('company_id', ctx.company_id).eq('user_id', ctx.user_id);

    const unreadOnly = url.searchParams.get('unread_only');
    if (unreadOnly === 'true') query = query.eq('read', false);

    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    const { data, count } = await query;

    return Response.json({ data: data || [], meta: { total: count || 0, page, limit } });
  })(req, { params: Promise.resolve({}) });
});
