import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('invoices.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const today = new Date().toISOString().slice(0, 10);

    // Pending (not overdue)
    const { data: pending } = await admin
      .from('invoices')
      .select('amount_residual')
      .eq('company_id', ctx.company_id)
      .eq('type', 'receivable')
      .gt('amount_residual', 0)
      .gte('date_due', today);

    // Overdue
    const { data: overdue } = await admin
      .from('invoices')
      .select('amount_residual')
      .eq('company_id', ctx.company_id)
      .eq('type', 'receivable')
      .gt('amount_residual', 0)
      .lt('date_due', today);

    const pendingTotal = (pending || []).reduce((sum, i) => sum + (i.amount_residual || 0), 0);
    const overdueTotal = (overdue || []).reduce((sum, i) => sum + (i.amount_residual || 0), 0);

    return Response.json({
      data: {
        pending_count: pending?.length || 0,
        pending_total: pendingTotal,
        overdue_count: overdue?.length || 0,
        overdue_total: overdueTotal,
        total: pendingTotal + overdueTotal,
      },
    });
  }))(req, { params: Promise.resolve({}) });
});
