import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('approvals.manage', async (_req, ctx) => {
    const admin = getAdminClient();

    const { data } = await admin
      .from('approval_requests')
      .select('*')
      .eq('company_id', ctx.company_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    return Response.json(data || []);
  }))(req, { params: Promise.resolve({}) });
});
