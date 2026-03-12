import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req, params) => {
  return withAuth(withRbac('invoices.read', async (_req, ctx) => {
    const id = params.id;
    const admin = getAdminClient();

    const { data } = await admin
      .from('invoices')
      .select('*')
      .eq('company_id', ctx.company_id)
      .eq('vendor_id', id)
      .order('date_invoice', { ascending: false });

    return Response.json(data || []);
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'read' });
