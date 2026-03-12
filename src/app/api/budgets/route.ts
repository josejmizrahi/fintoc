import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { budgetCreateSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('budgets.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data } = await admin.from('budgets').select('*').eq('company_id', ctx.company_id).order('period_start', { ascending: false });
    return Response.json({ data: data || [] });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('budgets.write', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }
    const result = budgetCreateSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    if (new Date(result.data.period_end) <= new Date(result.data.period_start)) {
      throw new ApiError('VALIDATION_ERROR', 'period_end debe ser mayor a period_start', 400);
    }

    const admin = getAdminClient();
    const { data: budget, error } = await admin.from('budgets').insert({
      company_id: ctx.company_id, ...result.data,
    }).select().single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'Error al crear presupuesto', 500);

    await writeAuditLog({ company_id: ctx.company_id, user_id: ctx.user_id, action: 'budget.created', entity_type: 'budget', entity_id: budget.id });
    return Response.json({ data: budget }, { status: 201 });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
