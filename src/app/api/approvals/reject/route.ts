import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { approvalRejectSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('expenses.approve', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = approvalRejectSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const admin = getAdminClient();
    const { data: request } = await admin.from('approval_requests').select('*')
      .eq('id', result.data.request_id).eq('company_id', ctx.company_id).single();

    if (!request) throw new ApiError('NOT_FOUND', 'Solicitud no encontrada', 404);
    if (request.status !== 'pending') throw new ApiError('VALIDATION_ERROR', 'Solicitud ya resuelta', 422);

    await admin.from('approval_requests').update({
      status: 'rejected', resolved_by: ctx.user_id, resolved_at: new Date().toISOString(),
      rejection_reason: result.data.reason,
    }).eq('id', result.data.request_id);

    if (request.entity_type === 'payment') {
      await admin.from('payments').update({ status: 'cancelled' }).eq('id', request.entity_id);
    }

    await writeAuditLog({ company_id: ctx.company_id, user_id: ctx.user_id, action: 'approval.rejected', entity_type: 'approval_request', entity_id: result.data.request_id });
    return Response.json({ data: { message: 'Solicitud rechazada' } });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
