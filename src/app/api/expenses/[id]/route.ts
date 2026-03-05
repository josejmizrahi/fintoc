import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req, params) => {
  return withAuth(withRbac('expenses.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data } = await admin.from('expenses').select('*').eq('id', params.id).eq('company_id', ctx.company_id).single();
    if (!data) throw new ApiError('NOT_FOUND', 'Gasto no encontrado', 404);
    return Response.json({ data });
  }))(req, { params: Promise.resolve(params) });
});
