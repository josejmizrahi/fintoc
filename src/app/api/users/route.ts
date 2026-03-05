import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('users.manage', async (_req, ctx) => {
    const admin = getAdminClient();

    const { data: memberships } = await admin
      .from('user_companies')
      .select('user_id, role, is_active, status, invited_at, accepted_at')
      .eq('company_id', ctx.company_id);

    if (!memberships || memberships.length === 0) {
      return Response.json([]);
    }

    const users = await Promise.all(
      memberships.map(async (m) => {
        const { data: userData } = await admin.auth.admin.getUserById(m.user_id);
        return {
          id: m.user_id,
          email: userData?.user?.email || '',
          name: userData?.user?.user_metadata?.full_name || '',
          role: m.role,
          is_active: m.is_active,
          status: m.status,
          invited_at: m.invited_at,
          accepted_at: m.accepted_at,
        };
      })
    );

    return Response.json(users);
  }))(req, { params: Promise.resolve({}) });
});
