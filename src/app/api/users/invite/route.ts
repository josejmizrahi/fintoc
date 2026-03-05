import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { inviteUserSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('users.manage', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = inviteUserSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const { email, role } = result.data;
    const admin = getAdminClient();

    // Check if already a member
    const { data: existingUsers } = await admin.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email === email);

    if (existingUser) {
      const { data: existingMember } = await admin
        .from('user_companies')
        .select('id')
        .eq('user_id', existingUser.id)
        .eq('company_id', ctx.company_id)
        .single();

      if (existingMember) {
        throw new ApiError('DUPLICATE', 'Este usuario ya es miembro de la empresa', 409);
      }

      // User exists, just add membership
      const { data: membership, error } = await admin
        .from('user_companies')
        .insert({
          user_id: existingUser.id,
          company_id: ctx.company_id,
          role,
          is_active: false,
          status: 'invited',
          invited_by: ctx.user_id,
          invited_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw new ApiError('INTERNAL_ERROR', 'Error al crear invitacion', 500);

      await writeAuditLog({
        company_id: ctx.company_id,
        user_id: ctx.user_id,
        action: 'user.invited',
        entity_type: 'user_companies',
        entity_id: membership.id,
        changes: { after: { email, role } },
      });

      return Response.json({ data: { invitation: membership } }, { status: 201 });
    }

    // User doesn't exist, invite via Supabase
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);
    if (inviteError) throw new ApiError('INTERNAL_ERROR', 'Error al enviar invitacion', 500);

    const { data: membership, error: memberError } = await admin
      .from('user_companies')
      .insert({
        user_id: inviteData.user.id,
        company_id: ctx.company_id,
        role,
        is_active: false,
        status: 'invited',
        invited_by: ctx.user_id,
        invited_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (memberError) throw new ApiError('INTERNAL_ERROR', 'Error al crear membresia', 500);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'user.invited',
      entity_type: 'user_companies',
      entity_id: membership.id,
      changes: { after: { email, role } },
    });

    return Response.json({ data: { invitation: membership } }, { status: 201 });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
