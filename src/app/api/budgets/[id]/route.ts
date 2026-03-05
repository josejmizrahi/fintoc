import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { budgetUpdateSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req, params) => {
  return withAuth(withRbac('budgets.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data } = await admin.from('budgets').select('*').eq('id', params.id).eq('company_id', ctx.company_id).single();
    if (!data) throw new ApiError('NOT_FOUND', 'Presupuesto no encontrado', 404);
    return Response.json({ data });
  }))(req, { params: Promise.resolve(params) });
});

export const PUT = createHandler(async (req, params) => {
  return withAuth(withRbac('budgets.write', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }
    const result = budgetUpdateSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const admin = getAdminClient();
    const { data, error } = await admin.from('budgets').update(result.data).eq('id', params.id).eq('company_id', ctx.company_id).select().single();
    if (error || !data) throw new ApiError('NOT_FOUND', 'Presupuesto no encontrado', 404);
    return Response.json({ data });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });

export const DELETE = createHandler(async (req, params) => {
  return withAuth(withRbac('budgets.write', async (_req, ctx) => {
    const admin = getAdminClient();
    const { error } = await admin.from('budgets').delete().eq('id', params.id).eq('company_id', ctx.company_id);
    if (error) throw new ApiError('NOT_FOUND', 'Presupuesto no encontrado', 404);
    return new Response(null, { status: 204 });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });
