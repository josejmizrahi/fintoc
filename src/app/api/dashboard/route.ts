import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

// GET /api/dashboard (KPIs + recent activity)
export const GET = createHandler(async (req) => {
  return withAuth(withRbac('dashboard.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const today = new Date().toISOString().split('T')[0];

    // Run all queries in parallel
    const [
      balanceResult,
      receivableResult,
      payableResult,
      overdueDateDueResult,
      overdueDueDateResult,
      recentPaymentsResult,
      overdueInvoicesResult,
    ] = await Promise.all([
      // Total bank balance
      admin.from('bank_accounts').select('balance').eq('company_id', ctx.company_id),
      // Accounts receivable (open invoices)
      admin.from('invoices').select('amount_residual')
        .eq('company_id', ctx.company_id).eq('type', 'receivable').gt('amount_residual', 0),
      // Accounts payable (open bills)
      admin.from('invoices').select('amount_residual')
        .eq('company_id', ctx.company_id).eq('type', 'payable').gt('amount_residual', 0),
      // Overdue invoices via date_due (seed data / manual creates)
      admin.from('invoices').select('id, amount_residual')
        .eq('company_id', ctx.company_id).gt('amount_residual', 0).lt('date_due', today),
      // Overdue invoices via due_date (Odoo sync creates)
      admin.from('invoices').select('id, amount_residual')
        .eq('company_id', ctx.company_id).gt('amount_residual', 0).lt('due_date', today),
      // Recent payments (last 5)
      admin.from('payments')
        .select('id, partner_name, reference_id, amount, status, direction, created_at, executed_at')
        .eq('company_id', ctx.company_id)
        .order('created_at', { ascending: false })
        .limit(5),
      // Overdue invoice list (last 5)
      admin.from('invoices')
        .select('id, partner_name, name, amount_total, amount_residual, date_due, due_date, type, status')
        .eq('company_id', ctx.company_id)
        .gt('amount_residual', 0)
        .lt('date_due', today)
        .order('date_due', { ascending: true })
        .limit(5),
    ]);

    // Check for query errors and log them
    const queryResults = [balanceResult, receivableResult, payableResult, overdueDateDueResult, overdueDueDateResult, recentPaymentsResult, overdueInvoicesResult];
    for (const result of queryResults) {
      if (result.error) {
        console.error('Dashboard query error:', result.error.message);
      }
    }

    const totalBalance = (balanceResult.data || []).reduce((s, a) => s + (a.balance || 0), 0);
    const receivable = receivableResult.data || [];
    const payable = payableResult.data || [];

    // Merge overdue invoices from both date columns, deduplicating by id
    const overdueMap = new Map<number, { amount_residual: number }>();
    for (const inv of (overdueDateDueResult.data || [])) {
      overdueMap.set(inv.id, inv);
    }
    for (const inv of (overdueDueDateResult.data || [])) {
      if (!overdueMap.has(inv.id)) overdueMap.set(inv.id, inv);
    }
    const overdue = [...overdueMap.values()];

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
