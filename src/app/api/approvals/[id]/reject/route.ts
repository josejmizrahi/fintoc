import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

/** POST /api/approvals/:id/reject — client sends { reason } in body. */
export const POST = createHandler(async (req, params) => {
  return withAuth(withRbac('expenses.approve', async (_req, ctx) => {
    const requestId = params.id;
    if (!requestId) throw new ApiError('VALIDATION_ERROR', 'request_id invalido', 400);

    let body: unknown;
    try {
      body = await _req.json();
    } catch {
      throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400);
    }
    const reason = typeof body === 'object' && body !== null && 'reason' in body
      ? String((body as { reason: unknown }).reason)
      : '';
    if (!reason.trim()) throw new ApiError('VALIDATION_ERROR', 'reason requerido', 400);

    const admin = getAdminClient();
    const { data: request } = await admin.from('approval_requests').select('*')
      .eq('id', requestId).eq('company_id', ctx.company_id).single();

    if (!request) throw new ApiError('NOT_FOUND', 'Solicitud no encontrada', 404);
    if (request.status !== 'pending') throw new ApiError('VALIDATION_ERROR', 'Solicitud ya resuelta', 422);

    await admin.from('approval_requests').update({
      status: 'rejected',
      resolved_by: ctx.user_id,
      resolved_at: new Date().toISOString(),
      rejection_reason: reason.trim(),
    }).eq('id', requestId);

    if (request.entity_type === 'payment') {
      await admin.from('payments').update({ status: 'cancelled' }).eq('id', request.entity_id);
    }

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'approval.rejected',
      entity_type: 'approval_request',
      entity_id: requestId,
    });
    return Response.json({ data: { message: 'Solicitud rechazada' } });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });
