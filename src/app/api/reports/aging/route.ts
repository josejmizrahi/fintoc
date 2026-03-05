import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('reports.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data: invoices } = await admin.from('invoices').select('*, customers:customer_id(id, name)')
      .eq('company_id', ctx.company_id).eq('type', 'receivable').gt('amount_residual', 0);

    const today = new Date();
    const totals: Record<string, number> = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    const byCustomer = new Map<string, { customer: unknown; total: number }>();

    for (const inv of (invoices || [])) {
      const days = inv.due_date ? Math.floor((today.getTime() - new Date(inv.due_date).getTime()) / 86400000) : 0;
      const amount = inv.amount_residual || 0;
      if (days <= 30) totals['0-30'] += amount;
      else if (days <= 60) totals['31-60'] += amount;
      else if (days <= 90) totals['61-90'] += amount;
      else totals['90+'] += amount;

      const cid = inv.customer_id || 'unknown';
      if (!byCustomer.has(cid)) byCustomer.set(cid, { customer: inv.customers, total: 0 });
      byCustomer.get(cid)!.total += amount;
    }

    return Response.json({ data: { totals, by_customer: Array.from(byCustomer.values()).sort((a, b) => b.total - a.total) } });
  }))(req, { params: Promise.resolve({}) });
});
