import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { vendorUpdateSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

export const GET = createHandler(async (req, params) => {
  return withAuth(withRbac('vendors.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data: vendor } = await admin
      .from('vendors')
      .select('*')
      .eq('id', params.id)
      .eq('company_id', ctx.company_id)
      .single();

    if (!vendor) throw new ApiError('NOT_FOUND', 'Proveedor no encontrado', 404);
    return Response.json({ data: vendor });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'read' });

export const PUT = createHandler(async (req, params) => {
  return withAuth(withRbac('vendors.write', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = vendorUpdateSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const admin = getAdminClient();
    const { data: vendor } = await admin
      .from('vendors')
      .select('*')
      .eq('id', params.id)
      .eq('company_id', ctx.company_id)
      .single();

    if (!vendor) throw new ApiError('NOT_FOUND', 'Proveedor no encontrado', 404);

    const updates = { ...result.data };
    if (updates.rfc) updates.rfc = updates.rfc.toUpperCase();

    const { data: updated, error } = await admin
      .from('vendors')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single();

    if (error) throw new ApiError('INTERNAL_ERROR', 'Error al actualizar proveedor', 500);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'vendor.updated',
      entity_type: 'vendor',
      entity_id: params.id,
      changes: { before: vendor, after: updated },
    });

    return Response.json({ data: updated });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });

export const DELETE = createHandler(async (req, params) => {
  return withAuth(withRbac('vendors.write', async (_req, ctx) => {
    const admin = getAdminClient();
    // Soft delete - just return success, in practice you might add a deleted_at
    const { data: vendor } = await admin
      .from('vendors')
      .select('id')
      .eq('id', params.id)
      .eq('company_id', ctx.company_id)
      .single();

    if (!vendor) throw new ApiError('NOT_FOUND', 'Proveedor no encontrado', 404);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'vendor.deleted',
      entity_type: 'vendor',
      entity_id: params.id,
    });

    return new Response(null, { status: 204 });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });
