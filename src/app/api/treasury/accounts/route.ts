import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('treasury.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data } = await admin.from('bank_accounts').select('*').eq('company_id', ctx.company_id);
    return Response.json({ data: data || [] });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
