import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { updateRoleSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

export const PUT = createHandler(async (req, params) => {
  return withAuth(withRbac('users.manage', async (_req, ctx) => {
    const targetUserId = params.id;

    if (targetUserId === ctx.user_id) {
      throw new ApiError('FORBIDDEN', 'No puedes cambiar tu propio rol', 403);
    }

    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = updateRoleSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Rol invalido', 400);

    const { role } = result.data;
    const admin = getAdminClient();

    // Get current membership
    const { data: membership } = await admin
      .from('user_companies')
      .select('id, role')
      .eq('user_id', targetUserId)
      .eq('company_id', ctx.company_id)
      .single();

    if (!membership) throw new ApiError('NOT_FOUND', 'Usuario no encontrado en esta empresa', 404);

    // Check we won't leave company without admins
    if (membership.role === 'admin' && role !== 'admin') {
      const { count } = await admin
        .from('user_companies')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', ctx.company_id)
        .eq('role', 'admin')
        .eq('status', 'active');

      if ((count || 0) <= 1) {
        throw new ApiError('FORBIDDEN', 'No puedes dejar la empresa sin administradores', 403);
      }
    }

    const { error } = await admin
      .from('user_companies')
      .update({ role })
      .eq('user_id', targetUserId)
      .eq('company_id', ctx.company_id);

    if (error) throw new ApiError('INTERNAL_ERROR', 'Error al actualizar rol', 500);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'user.role_changed',
      entity_type: 'user_companies',
      entity_id: membership.id,
      changes: { before: { role: membership.role }, after: { role } },
    });

    return Response.json({ data: { user_id: targetUserId, role } });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });
