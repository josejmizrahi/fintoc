import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('collections.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const today = new Date().toISOString().split('T')[0];

    const { data } = await admin
      .from('invoices')
      .select('*, customers:customer_id(id, name)')
      .eq('company_id', ctx.company_id)
      .eq('type', 'out_invoice')
      .gt('amount_residual', 0)
      .lt('due_date', today)
      .order('amount_residual', { ascending: false })
      .limit(5);

    const total = (data || []).reduce((s, i) => s + (i.amount_residual || 0), 0);

    return Response.json({
      data: { total, count: data?.length || 0, top: data || [] },
    });
  }))(req, { params: Promise.resolve({}) });
});
