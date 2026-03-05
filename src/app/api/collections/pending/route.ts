import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';
import { parsePaginationParams } from '@/lib/utils/response';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('collections.read', async (_req, ctx) => {
    const url = new URL(_req.url);
    const { page, limit } = parsePaginationParams(url);
    const offset = (page - 1) * limit;
    const today = new Date().toISOString().split('T')[0];
    const admin = getAdminClient();

    const { data, count, error } = await admin
      .from('invoices')
      .select('*, customers:customer_id(id, name, rfc)', { count: 'exact' })
      .eq('company_id', ctx.company_id)
      .eq('type', 'receivable')
      .gt('amount_residual', 0)
      .or(`due_date.is.null,due_date.gte.${today}`)
      .order('due_date', { ascending: true })
      .range(offset, offset + limit - 1);

    return Response.json({
      data: data || [],
      meta: { total: count || 0, page, limit },
    });
  }))(req, { params: Promise.resolve({}) });
});
