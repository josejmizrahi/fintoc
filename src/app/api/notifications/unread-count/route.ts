import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(async (_req, ctx) => {
    const admin = getAdminClient();

    const { count, error } = await admin
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', ctx.company_id)
      .eq('user_id', ctx.user_id)
      .eq('read', false);

    if (error) {
      return Response.json({ count: 0 });
    }

    return Response.json({ count: count || 0 });
  })(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
