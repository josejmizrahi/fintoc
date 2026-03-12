import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { approvalRuleUpdateSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

export const GET = createHandler(async (req, params) => {
  return withAuth(withRbac('approvals.manage', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data } = await admin.from('approval_rules').select('*').eq('id', params.id).eq('company_id', ctx.company_id).single();
    if (!data) throw new ApiError('NOT_FOUND', 'Regla no encontrada', 404);
    return Response.json({ data });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'read' });

export const PUT = createHandler(async (req, params) => {
  return withAuth(withRbac('approvals.manage', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }
    const result = approvalRuleUpdateSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const admin = getAdminClient();
    const { data, error } = await admin.from('approval_rules').update(result.data).eq('id', params.id).eq('company_id', ctx.company_id).select().single();
    if (error || !data) throw new ApiError('NOT_FOUND', 'Regla no encontrada', 404);

    writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'approval_rule.updated',
      entity_type: 'approval_rule',
      entity_id: params.id,
      changes: { after: result.data as Record<string, unknown> },
    });

    return Response.json({ data });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });

export const DELETE = createHandler(async (req, params) => {
  return withAuth(withRbac('approvals.manage', async (_req, ctx) => {
    const admin = getAdminClient();
    await admin.from('approval_rules').update({ active: false }).eq('id', params.id).eq('company_id', ctx.company_id);

    writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'approval_rule.deleted',
      entity_type: 'approval_rule',
      entity_id: params.id,
    });

    return new Response(null, { status: 204 });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });
