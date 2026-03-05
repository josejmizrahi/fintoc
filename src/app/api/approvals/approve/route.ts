import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { approvalActionSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('expenses.approve', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = approvalActionSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'request_id invalido', 400);

    const admin = getAdminClient();
    const { data: request } = await admin.from('approval_requests').select('*, approval_rules:rule_id(approvers)')
      .eq('id', result.data.request_id).eq('company_id', ctx.company_id).single();

    if (!request) throw new ApiError('NOT_FOUND', 'Solicitud no encontrada', 404);
    if (request.status !== 'pending') throw new ApiError('VALIDATION_ERROR', 'Solicitud ya resuelta', 422);

    // Verify user is an approver
    const rule = request.approval_rules as Record<string, unknown> | null;
    const approvers = (rule?.approvers as string[]) || [];
    if (ctx.role !== 'admin' && !approvers.includes(ctx.user_id)) {
      throw new ApiError('FORBIDDEN', 'No eres aprobador designado', 403);
    }

    // Approve the request
    await admin.from('approval_requests').update({
      status: 'approved', resolved_by: ctx.user_id, resolved_at: new Date().toISOString(),
    }).eq('id', result.data.request_id);

    // Update the entity
    if (request.entity_type === 'payment') {
      await admin.from('payments').update({ status: 'pending' }).eq('id', request.entity_id);
      // Notify requester
      if (request.requested_by) {
        await admin.from('notifications').insert({
          company_id: ctx.company_id, user_id: request.requested_by,
          event_type: 'payment.approved', entity_type: 'payment', entity_id: request.entity_id,
          title: 'Pago aprobado', message: `Tu pago de $${request.amount} fue aprobado`, read: false,
        });
      }
    }

    await writeAuditLog({ company_id: ctx.company_id, user_id: ctx.user_id, action: 'approval.approved', entity_type: 'approval_request', entity_id: result.data.request_id });
    return Response.json({ data: { message: 'Solicitud aprobada' } });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
