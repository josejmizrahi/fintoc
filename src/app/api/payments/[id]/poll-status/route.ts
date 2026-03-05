import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';

export const POST = createHandler(async (req, params) => {
  return withAuth(withRbac('payments.read', async (_req, ctx) => {
    const id = params.id;
    const admin = getAdminClient();

    const { data: payment, error } = await admin
      .from('payments')
      .select('*')
      .eq('id', id)
      .eq('company_id', ctx.company_id)
      .single();

    if (error || !payment) throw new ApiError('NOT_FOUND', 'Pago no encontrado', 404);

    return Response.json({ data: payment });
  }))(req, { params: Promise.resolve(params) });
});
