import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('reports.read', async (_req, ctx) => {
    const admin = getAdminClient();

    const { data: vendors } = await admin.from('vendors').select('id, name, rfc').eq('company_id', ctx.company_id);
    const { data: payments } = await admin.from('payments').select('vendor_id, amount, confirmed_at')
      .eq('company_id', ctx.company_id).eq('status', 'confirmed');
    const { data: invoices } = await admin.from('invoices').select('vendor_id')
      .eq('company_id', ctx.company_id).eq('type', 'payable');

    const result = (vendors || []).map(vendor => {
      const vendorPayments = (payments || []).filter(p => p.vendor_id === vendor.id);
      const vendorInvoices = (invoices || []).filter(i => i.vendor_id === vendor.id);
      const totalSpent = vendorPayments.reduce((s, p) => s + (p.amount || 0), 0);
      const avgPayment = vendorPayments.length > 0 ? totalSpent / vendorPayments.length : 0;

      return {
        vendor: { id: vendor.id, name: vendor.name, rfc: vendor.rfc },
        total_spent: totalSpent,
        invoice_count: vendorInvoices.length,
        payment_count: vendorPayments.length,
        avg_payment: Math.round(avgPayment * 100) / 100,
      };
    }).filter(v => v.total_spent > 0).sort((a, b) => b.total_spent - a.total_spent);

    return Response.json({ data: result });
  }))(req, { params: Promise.resolve({}) });
});
