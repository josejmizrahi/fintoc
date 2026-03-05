import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { approvalRuleCreateSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('approvals.manage', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data } = await admin.from('approval_rules').select('*').eq('company_id', ctx.company_id).order('amount_min');
    return Response.json({ data: data || [] });
  }))(req, { params: Promise.resolve({}) });
});

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('approvals.manage', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = approvalRuleCreateSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const admin = getAdminClient();
    const { data: rule, error } = await admin.from('approval_rules').insert({
      company_id: ctx.company_id, ...result.data,
    }).select().single();

    if (error) throw new ApiError('INTERNAL_ERROR', 'Error al crear regla', 500);

    await writeAuditLog({ company_id: ctx.company_id, user_id: ctx.user_id, action: 'approval_rule.created', entity_type: 'approval_rule', entity_id: rule.id });
    return Response.json({ data: rule }, { status: 201 });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
