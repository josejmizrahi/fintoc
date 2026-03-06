import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { companyUpdateSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

export const GET = createHandler(async (req, params) => {
  return withAuth(async (_req, _ctx) => {
    const admin = getAdminClient();
    const { data } = await admin.from('companies').select('*').eq('id', params.id).single();
    if (!data) throw new ApiError('NOT_FOUND', 'Empresa no encontrada', 404);
    return Response.json({ data });
  })(req, { params: Promise.resolve(params) });
});

export const PUT = createHandler(async (req, params) => {
  return withAuth(withRbac('config.write', async (_req, ctx) => {
    if (params.id !== ctx.company_id) throw new ApiError('FORBIDDEN', 'Solo puedes editar tu empresa activa', 403);

    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }
    const result = companyUpdateSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const admin = getAdminClient();
    const updates = { ...result.data };
    if (updates.rfc) updates.rfc = updates.rfc.toUpperCase();

    const { data, error } = await admin.from('companies').update(updates).eq('id', params.id).select().single();
    if (error || !data) throw new ApiError('INTERNAL_ERROR', 'Error al actualizar empresa', 500);

    await writeAuditLog({ company_id: ctx.company_id, user_id: ctx.user_id, action: 'company.updated', entity_type: 'company', entity_id: params.id });
    return Response.json({ data });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });
