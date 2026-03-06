import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

export const POST = createHandler(async (req, params) => {
  return withAuth(withRbac('expenses.approve', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data: expense } = await admin.from('expenses').select('*').eq('id', params.id).eq('company_id', ctx.company_id).single();
    if (!expense) throw new ApiError('NOT_FOUND', 'Gasto no encontrado', 404);
    if (!['pending', 'submitted'].includes(expense.status)) throw new ApiError('VALIDATION_ERROR', 'Solo se pueden aprobar gastos pendientes', 422);

    await admin.from('expenses').update({ status: 'approved', approved_by: ctx.user_id }).eq('id', params.id);

    // Notify creator
    if (expense.created_by) {
      await admin.from('notifications').insert({
        company_id: ctx.company_id,
        user_id: expense.created_by,
        event_type: 'expense.approved',
        entity_type: 'expense',
        entity_id: params.id,
        title: 'Gasto aprobado',
        message: `Tu gasto de $${expense.amount} fue aprobado`,
        read: false,
      });
    }

    await writeAuditLog({ company_id: ctx.company_id, user_id: ctx.user_id, action: 'expense.approved', entity_type: 'expense', entity_id: params.id });
    return Response.json({ data: { message: 'Gasto aprobado' } });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });
