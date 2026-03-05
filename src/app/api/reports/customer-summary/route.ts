import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('reports.read', async (_req, ctx) => {
    const admin = getAdminClient();

    const { data: customers } = await admin.from('customers').select('id, name, rfc').eq('company_id', ctx.company_id);
    const { data: invoices } = await admin.from('invoices').select('customer_id, amount_total, amount_paid')
      .eq('company_id', ctx.company_id).eq('type', 'receivable');

    const result = (customers || []).map(customer => {
      const custInvoices = (invoices || []).filter(i => i.customer_id === customer.id);
      const totalRevenue = custInvoices.reduce((s, i) => s + (i.amount_total || 0), 0);

      return {
        customer: { id: customer.id, name: customer.name, rfc: customer.rfc },
        total_revenue: totalRevenue,
        invoice_count: custInvoices.length,
      };
    }).filter(c => c.total_revenue > 0).sort((a, b) => b.total_revenue - a.total_revenue);

    return Response.json({ data: result });
  }))(req, { params: Promise.resolve({}) });
});
