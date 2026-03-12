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
}, { rateLimit: 'read' });

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('approvals.manage', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    // Accept form fields min_amount/max_amount and map to amount_min/amount_max for validation and matching logic
    const normalized = typeof body === 'object' && body !== null ? { ...(body as Record<string, unknown>) } : {};
    if ('min_amount' in normalized && (normalized.amount_min === undefined || normalized.amount_min === null)) {
      normalized.amount_min = normalized.min_amount;
    }
    if ('max_amount' in normalized && (normalized.amount_max === undefined || normalized.amount_max === null)) {
      normalized.amount_max = normalized.max_amount;
    }

    const result = approvalRuleCreateSchema.safeParse(normalized);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const admin = getAdminClient();
    const { amount_min, amount_max, ...rest } = result.data;
    const row = {
      company_id: ctx.company_id,
      ...rest,
      amount_min: amount_min ?? 0,
      amount_max: amount_max ?? null,
      min_amount: amount_min ?? 0,
      max_amount: amount_max ?? null,
    };
    const { data: rule, error } = await admin.from('approval_rules').insert(row)
      .select().single();

    if (error) throw new ApiError('INTERNAL_ERROR', 'Error al crear regla', 500);

    await writeAuditLog({ company_id: ctx.company_id, user_id: ctx.user_id, action: 'approval_rule.created', entity_type: 'approval_rule', entity_id: rule.id });
    return Response.json({ data: rule }, { status: 201 });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
