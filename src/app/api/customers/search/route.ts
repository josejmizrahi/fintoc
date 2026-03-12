import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('customers.read', async (_req, ctx) => {
    const url = new URL(_req.url);
    const q = url.searchParams.get('q') || '';
    if (q.length < 2) return Response.json([]);

    const admin = getAdminClient();
    const { data } = await admin
      .from('customers')
      .select('*')
      .eq('company_id', ctx.company_id)
      .or(`name.ilike.%${q}%,rfc.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(20);

    return Response.json(data || []);
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
