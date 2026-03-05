import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('collections.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const today = new Date();

    const { data: invoices } = await admin
      .from('invoices')
      .select('*, customers:customer_id(id, name, rfc)')
      .eq('company_id', ctx.company_id)
      .eq('type', 'receivable')
      .gt('amount_residual', 0);

    const buckets = [
      { range: '0-30', amount: 0, count: 0 },
      { range: '31-60', amount: 0, count: 0 },
      { range: '61-90', amount: 0, count: 0 },
      { range: '90+', amount: 0, count: 0 },
    ];

    const byCustomer = new Map<string, { customer_id: string; name: string; total: number; invoices: unknown[] }>();

    for (const inv of (invoices || [])) {
      const daysOld = inv.due_date
        ? Math.floor((today.getTime() - new Date(inv.due_date).getTime()) / 86400000)
        : 0;

      const amount = inv.amount_residual || 0;

      if (daysOld <= 30) { buckets[0].amount += amount; buckets[0].count++; }
      else if (daysOld <= 60) { buckets[1].amount += amount; buckets[1].count++; }
      else if (daysOld <= 90) { buckets[2].amount += amount; buckets[2].count++; }
      else { buckets[3].amount += amount; buckets[3].count++; }

      const custId = inv.customer_id || 'unknown';
      const custName = (inv.customers as Record<string, unknown>)?.name as string || 'Sin cliente';
      if (!byCustomer.has(custId)) {
        byCustomer.set(custId, { customer_id: custId, name: custName, total: 0, invoices: [] });
      }
      const entry = byCustomer.get(custId)!;
      entry.total += amount;
      entry.invoices.push(inv);
    }

    return Response.json({
      data: {
        buckets,
        by_customer: Array.from(byCustomer.values()).sort((a, b) => b.total - a.total),
      },
    });
  }))(req, { params: Promise.resolve({}) });
});
