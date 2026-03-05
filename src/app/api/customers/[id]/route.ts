import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { customerUpdateSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

export const GET = createHandler(async (req, params) => {
  return withAuth(withRbac('customers.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data } = await admin.from('customers').select('*').eq('id', params.id).eq('company_id', ctx.company_id).single();
    if (!data) throw new ApiError('NOT_FOUND', 'Cliente no encontrado', 404);
    return Response.json({ data });
  }))(req, { params: Promise.resolve(params) });
});

export const PUT = createHandler(async (req, params) => {
  return withAuth(withRbac('customers.write', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = customerUpdateSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const admin = getAdminClient();
    const updates = { ...result.data };
    if (updates.rfc) updates.rfc = updates.rfc.toUpperCase();

    const { data, error } = await admin.from('customers').update(updates).eq('id', params.id).eq('company_id', ctx.company_id).select().single();
    if (error || !data) throw new ApiError('NOT_FOUND', 'Cliente no encontrado', 404);

    await writeAuditLog({ company_id: ctx.company_id, user_id: ctx.user_id, action: 'customer.updated', entity_type: 'customer', entity_id: params.id });
    return Response.json({ data });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });

export const DELETE = createHandler(async (req, params) => {
  return withAuth(withRbac('customers.write', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data } = await admin.from('customers').select('id').eq('id', params.id).eq('company_id', ctx.company_id).single();
    if (!data) throw new ApiError('NOT_FOUND', 'Cliente no encontrado', 404);

    await writeAuditLog({ company_id: ctx.company_id, user_id: ctx.user_id, action: 'customer.deleted', entity_type: 'customer', entity_id: params.id });
    return new Response(null, { status: 204 });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });
