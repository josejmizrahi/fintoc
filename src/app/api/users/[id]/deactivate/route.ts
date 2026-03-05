import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

export const PUT = createHandler(async (req, params) => {
  return withAuth(withRbac('users.manage', async (_req, ctx) => {
    const targetUserId = params.id;

    if (targetUserId === ctx.user_id) {
      throw new ApiError('FORBIDDEN', 'No puedes desactivarte a ti mismo', 403);
    }

    const admin = getAdminClient();

    const { data: membership } = await admin
      .from('user_companies')
      .select('id')
      .eq('user_id', targetUserId)
      .eq('company_id', ctx.company_id)
      .single();

    if (!membership) throw new ApiError('NOT_FOUND', 'Usuario no encontrado', 404);

    const { error } = await admin
      .from('user_companies')
      .update({ status: 'deactivated', is_active: false })
      .eq('user_id', targetUserId)
      .eq('company_id', ctx.company_id);

    if (error) throw new ApiError('INTERNAL_ERROR', 'Error al desactivar usuario', 500);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'user.deactivated',
      entity_type: 'user_companies',
      entity_id: membership.id,
    });

    return Response.json({ data: { message: 'Usuario desactivado' } });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });
