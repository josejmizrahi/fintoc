import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

// GET /api/dashboard (KPIs)
export const GET = createHandler(async (req) => {
  return withAuth(withRbac('dashboard.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const today = new Date().toISOString().split('T')[0];

    // Run all queries in parallel
    const [balanceResult, receivableResult, payableResult, overdueResult] = await Promise.all([
      // Total bank balance
      admin.from('bank_accounts').select('balance').eq('company_id', ctx.company_id),
      // Accounts receivable
      admin.from('invoices').select('amount_residual')
        .eq('company_id', ctx.company_id).eq('type', 'receivable').gt('amount_residual', 0),
      // Accounts payable
      admin.from('invoices').select('amount_residual')
        .eq('company_id', ctx.company_id).eq('type', 'payable').gt('amount_residual', 0),
      // Overdue
      admin.from('invoices').select('amount_residual')
        .eq('company_id', ctx.company_id).gt('amount_residual', 0).lt('due_date', today),
    ]);

    const saldoActual = (balanceResult.data || []).reduce((s, a) => s + (a.balance || 0), 0);
    const porCobrar = (receivableResult.data || []);
    const porPagar = (payableResult.data || []);
    const vencidas = (overdueResult.data || []);

    return Response.json({
      data: {
        saldo_actual: saldoActual,
        por_cobrar: {
          amount: porCobrar.reduce((s, i) => s + (i.amount_residual || 0), 0),
          count: porCobrar.length,
        },
        por_pagar: {
          amount: porPagar.reduce((s, i) => s + (i.amount_residual || 0), 0),
          count: porPagar.length,
        },
        vencidas: {
          amount: vencidas.reduce((s, i) => s + (i.amount_residual || 0), 0),
          count: vencidas.length,
        },
      },
    });
  }))(req, { params: Promise.resolve({}) });
});
