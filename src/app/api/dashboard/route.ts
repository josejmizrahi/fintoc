import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

// GET /api/dashboard (KPIs + recent activity)
export const GET = createHandler(async (req) => {
  return withAuth(withRbac('dashboard.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const today = new Date().toISOString().split('T')[0];

    const [
      balanceResult,
      receivableResult,
      payableResult,
      overdueResult,
      recentPaymentsResult,
      overdueInvoicesResult,
    ] = await Promise.all([
      admin.from('bank_accounts').select('balance').eq('company_id', ctx.company_id),
      admin.from('invoices').select('amount_residual')
        .eq('company_id', ctx.company_id).eq('type', 'receivable').gt('amount_residual', 0),
      admin.from('invoices').select('amount_residual')
        .eq('company_id', ctx.company_id).eq('type', 'payable').gt('amount_residual', 0),
      // Overdue invoices (unified due_date column)
      admin.from('invoices').select('id, amount_residual')
        .eq('company_id', ctx.company_id).gt('amount_residual', 0)
        .lt('due_date', today),
      admin.from('payments')
        .select('id, partner_name, reference_id, amount, status, direction, created_at, executed_at')
        .eq('company_id', ctx.company_id)
        .order('created_at', { ascending: false })
        .limit(5),
      admin.from('invoices')
        .select('id, partner_name, name, amount_total, amount_residual, due_date, type, status')
        .eq('company_id', ctx.company_id)
        .gt('amount_residual', 0)
        .lt('due_date', today)
        .order('due_date', { ascending: true })
        .limit(5),
    ]);

    const totalBalance = (balanceResult.data || []).reduce((s, a) => s + (a.balance || 0), 0);
    const receivable = receivableResult.data || [];
    const payable = payableResult.data || [];
    const overdue = overdueResult.data || [];

    return Response.json({
      total_balance: totalBalance,
      accounts_receivable: receivable.reduce((s, i) => s + (i.amount_residual || 0), 0),
      pending_invoices_count: receivable.length,
      accounts_payable: payable.reduce((s, i) => s + (i.amount_residual || 0), 0),
      pending_bills_count: payable.length,
      overdue_amount: overdue.reduce((s, i) => s + (i.amount_residual || 0), 0),
      overdue_invoices: overdue.length,
      recent_payments: recentPaymentsResult.data || [],
      overdue_invoice_list: overdueInvoicesResult.data || [],
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
