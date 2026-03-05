import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('invoices.read', async (_req, ctx) => {
    const admin = getAdminClient();

    const { data, error } = await admin
      .from('invoices')
      .select('amount_residual')
      .eq('company_id', ctx.company_id)
      .eq('type', 'in_invoice')
      .gt('amount_residual', 0);

    if (error) return Response.json({ data: { total_amount: 0, count: 0 } });

    const total = (data || []).reduce((sum, inv) => sum + (inv.amount_residual || 0), 0);
    return Response.json({
      data: { total_amount: total, count: data?.length || 0 },
    });
  }))(req, { params: Promise.resolve({}) });
});
