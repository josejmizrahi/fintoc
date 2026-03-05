import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(async (_req, ctx) => {
    const admin = getAdminClient();

    // Get user details
    const { data: user } = await admin.auth.admin.getUserById(ctx.user_id);

    // Get all companies for this user
    const { data: memberships } = await admin
      .from('user_companies')
      .select(`
        company_id,
        role,
        is_active,
        status,
        companies:company_id (id, name, rfc, onboarding_completed)
      `)
      .eq('user_id', ctx.user_id)
      .in('status', ['active', 'invited']);

    const activeCompany = memberships?.find(m => m.is_active);

    return Response.json({
      data: {
        id: ctx.user_id,
        email: ctx.email,
        full_name: user?.user?.user_metadata?.full_name || '',
        companies: (memberships || []).map((m: Record<string, unknown>) => ({
          ...(m.companies as Record<string, unknown> || {}),
          role: m.role,
          is_active: m.is_active,
        })),
        active_company: activeCompany
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? { ...((activeCompany.companies as any) || {}), role: activeCompany.role }
          : null,
      },
    });
  })(req, { params: Promise.resolve({}) });
});
