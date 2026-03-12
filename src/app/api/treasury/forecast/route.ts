import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('treasury.read', async (_req, ctx) => {
    const url = new URL(_req.url);
    const days = parseInt(url.searchParams.get('days') || '30', 10);
    const admin = getAdminClient();

    // Get current balance
    const { data: accounts } = await admin.from('bank_accounts').select('balance').eq('company_id', ctx.company_id);
    const currentBalance = (accounts || []).reduce((s, a) => s + (a.balance || 0), 0);

    // Get scheduled payments
    const { data: scheduled } = await admin.from('payments').select('amount, scheduled_date')
      .eq('company_id', ctx.company_id).in('status', ['draft', 'pending', 'scheduled']).not('scheduled_date', 'is', null);

    // Get pending receivables
    const { data: receivables } = await admin.from('invoices').select('amount_residual, due_date')
      .eq('company_id', ctx.company_id).eq('type', 'receivable').gt('amount_residual', 0);

    const today = new Date();
    const forecast: { date: string; optimistic: number; base: number; pessimistic: number }[] = [];
    let optBalance = currentBalance;
    let baseBalance = currentBalance;
    let pessBalance = currentBalance;

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];

      // Scheduled payments for this day
      const dayPayments = (scheduled || []).filter(p => p.scheduled_date === dateStr);
      const dayOutflow = dayPayments.reduce((s, p) => s + (p.amount || 0), 0);

      // Receivables due this day
      const dayReceivables = (receivables || []).filter(r => r.due_date === dateStr);
      const dayInflow = dayReceivables.reduce((s, r) => s + (r.amount_residual || 0), 0);

      optBalance += dayInflow - dayOutflow;
      baseBalance += (dayInflow * 0.7) - dayOutflow; // 70% collection rate
      pessBalance -= dayOutflow; // No inflows

      forecast.push({
        date: dateStr,
        optimistic: Math.round(optBalance * 100) / 100,
        base: Math.round(baseBalance * 100) / 100,
        pessimistic: Math.round(pessBalance * 100) / 100,
      });
    }

    return Response.json({ data: forecast });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
