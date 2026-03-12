import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

export const POST = createHandler(async (req, params) => {
  return withAuth(withRbac('payments.create', async (_req, ctx) => {
    const id = params.id;
    const admin = getAdminClient();

    const { data: payment, error } = await admin
      .from('payments')
      .select('*')
      .eq('id', id)
      .eq('company_id', ctx.company_id)
      .single();

    if (error || !payment) throw new ApiError('NOT_FOUND', 'Pago no encontrado', 404);
    if (payment.status !== 'failed') {
      throw new ApiError('VALIDATION_ERROR', 'Solo se pueden reintentar pagos fallidos', 422);
    }

    const { data: updated, error: updateError } = await admin
      .from('payments')
      .update({ status: 'draft', fintoc_error: null })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw new ApiError('INTERNAL_ERROR', 'Error al reintentar pago', 500);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'payment.retried',
      entity_type: 'payment',
      entity_id: id,
    });

    return Response.json({ data: updated });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });
