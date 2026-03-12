import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { expenseUpdateSchema } from '@/lib/validations/schemas';
import { writeAuditLog } from '@/lib/middleware/audit';

export const GET = createHandler(async (req, params) => {
  return withAuth(withRbac('expenses.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data } = await admin.from('expenses').select('*').eq('id', params.id).eq('company_id', ctx.company_id).single();
    if (!data) throw new ApiError('NOT_FOUND', 'Gasto no encontrado', 404);
    return Response.json({ data });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'read' });

export const PUT = createHandler(async (req, params) => {
  return withAuth(withRbac('expenses.write', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = expenseUpdateSchema.safeParse(body);
    if (!result.success) {
      throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);
    }

    const admin = getAdminClient();

    // Verify expense exists and belongs to company
    const { data: existing } = await admin.from('expenses').select('status').eq('id', params.id).eq('company_id', ctx.company_id).single();
    if (!existing) throw new ApiError('NOT_FOUND', 'Gasto no encontrado', 404);

    // Only draft/submitted expenses can be edited
    if (!['draft', 'submitted'].includes(existing.status)) {
      throw new ApiError('VALIDATION_ERROR', 'Solo se pueden editar gastos en borrador o enviados', 422);
    }

    const { data, error } = await admin
      .from('expenses')
      .update(result.data)
      .eq('id', params.id)
      .eq('company_id', ctx.company_id)
      .select()
      .single();

    if (error) throw new ApiError('DB_ERROR', 'Error al actualizar gasto', 500);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'expense.updated',
      entity_type: 'expense',
      entity_id: params.id,
      metadata: { fields: Object.keys(result.data) },
    });

    return Response.json({ data });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });
