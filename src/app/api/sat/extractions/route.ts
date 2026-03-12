import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('sat.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data: extractions } = await admin
      .from('syntage_extractions')
      .select('*')
      .eq('company_id', ctx.company_id)
      .order('started_at', { ascending: false });

    return Response.json({ data: extractions || [] });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
