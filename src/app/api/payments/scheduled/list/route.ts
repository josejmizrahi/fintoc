import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('payments.read', async (_req, ctx) => {
    const admin = getAdminClient();

    const { data: payments } = await admin
      .from('payments')
      .select('*, vendors:vendor_id(id, name, rfc)')
      .eq('company_id', ctx.company_id)
      .eq('status', 'scheduled')
      .order('scheduled_date', { ascending: true });

    return Response.json({ data: payments || [] });
  }))(req, { params: Promise.resolve({}) });
});
