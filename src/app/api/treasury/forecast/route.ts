import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

const DEFAULT_COLLECTION_RATE = 0.7; // 70% base collection rate
const DEFAULT_PESSIMISTIC_RATE = 0; // 0% — worst case, no inflows

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('treasury.read', async (_req, ctx) => {
    const url = new URL(_req.url);
    const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 365);
    const admin = getAdminClient();

    // Get company-specific collection rate (if configured)
    const { data: company } = await admin.from('companies')
      .select('config')
      .eq('id', ctx.company_id)
      .single();

    const companyConfig = (company?.config || {}) as Record<string, unknown>;
    const baseRate = Math.max(0, Math.min(1,
      Number(companyConfig.forecast_collection_rate ?? DEFAULT_COLLECTION_RATE),
    ));
    const pessRate = Math.max(0, Math.min(1,
      Number(companyConfig.forecast_pessimistic_rate ?? DEFAULT_PESSIMISTIC_RATE),
    ));

    // Get current balance
    const { data: accounts } = await admin.from('bank_accounts').select('balance').eq('company_id', ctx.company_id);
    const currentBalance = (accounts || []).reduce((s, a) => s + (a.balance || 0), 0);

    // Get scheduled payments (outflows)
    const { data: scheduled } = await admin.from('payments').select('amount, scheduled_date')
      .eq('company_id', ctx.company_id).in('status', ['draft', 'pending', 'scheduled']).not('scheduled_date', 'is', null);

    // Get pending receivables (inflows)
    const { data: receivables } = await admin.from('invoices').select('amount_residual, due_date')
      .eq('company_id', ctx.company_id).eq('type', 'receivable').gt('amount_residual', 0);

    // Get committed expenses (approved but not executed)
    const { data: committed } = await admin.from('expenses').select('amount')
      .eq('company_id', ctx.company_id).eq('status', 'approved');
    const committedTotal = (committed || []).reduce((s, e) => s + (e.amount || 0), 0);

    const today = new Date();
    const forecast: { date: string; optimistic: number; base: number; pessimistic: number }[] = [];
    let optBalance = currentBalance - committedTotal;
    let baseBalance = currentBalance - committedTotal;
    let pessBalance = currentBalance - committedTotal;

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

      optBalance += dayInflow - dayOutflow; // 100% collection
      baseBalance += (dayInflow * baseRate) - dayOutflow; // configurable rate
      pessBalance += (dayInflow * pessRate) - dayOutflow; // worst case

      forecast.push({
        date: dateStr,
        optimistic: Math.round(optBalance * 100) / 100,
        base: Math.round(baseBalance * 100) / 100,
        pessimistic: Math.round(pessBalance * 100) / 100,
      });
    }

    return Response.json({
      data: forecast,
      meta: {
        collection_rates: { optimistic: 1.0, base: baseRate, pessimistic: pessRate },
        committed_expenses: committedTotal,
        current_balance: currentBalance,
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
