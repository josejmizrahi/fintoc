import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { expenseRejectSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

export const POST = createHandler(async (req, params) => {
  return withAuth(withRbac('expenses.approve', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = expenseRejectSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'reason es requerido', 400);

    const admin = getAdminClient();
    const { data: expense } = await admin.from('expenses').select('*').eq('id', params.id).eq('company_id', ctx.company_id).single();
    if (!expense) throw new ApiError('NOT_FOUND', 'Gasto no encontrado', 404);
    if (!['pending', 'submitted'].includes(expense.status)) throw new ApiError('VALIDATION_ERROR', 'Solo se pueden rechazar gastos pendientes', 422);

    await admin.from('expenses').update({ status: 'rejected', rejected_reason: result.data.reason }).eq('id', params.id);

    if (expense.created_by) {
      await admin.from('notifications').insert({
        company_id: ctx.company_id, user_id: expense.created_by,
        event_type: 'expense.rejected', entity_type: 'expense', entity_id: params.id,
        title: 'Gasto rechazado', message: `Tu gasto fue rechazado: ${result.data.reason}`, read: false,
      });
    }

    await writeAuditLog({ company_id: ctx.company_id, user_id: ctx.user_id, action: 'expense.rejected', entity_type: 'expense', entity_id: params.id });
    return Response.json({ data: { message: 'Gasto rechazado' } });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });
