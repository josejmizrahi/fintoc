import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('budgets.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const today = new Date().toISOString().split('T')[0];

    const { data: budgets } = await admin.from('budgets').select('*')
      .eq('company_id', ctx.company_id).lte('period_start', today).gte('period_end', today);

    const { data: confirmedPayments } = await admin.from('payments').select('amount, concept')
      .eq('company_id', ctx.company_id).eq('status', 'confirmed');

    const { data: pendingPayments } = await admin.from('payments').select('amount, concept')
      .eq('company_id', ctx.company_id).in('status', ['pending', 'draft', 'processing']);

    const result = (budgets || []).map(budget => {
      const spent = (confirmedPayments || []).reduce((s, p) => s + (p.amount || 0), 0);
      const committed = (pendingPayments || []).reduce((s, p) => s + (p.amount || 0), 0);
      const available = budget.amount - spent - committed;
      const usagePercent = budget.amount > 0 ? ((spent + committed) / budget.amount) * 100 : 0;

      return {
        category: budget.category,
        budgeted: budget.amount,
        spent,
        committed,
        available: Math.max(0, available),
        usage_percent: Math.round(usagePercent * 100) / 100,
      };
    });

    return Response.json({ data: result });
  }))(req, { params: Promise.resolve({}) });
});
