import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('treasury.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const firstDayOfMonth = new Date();
    firstDayOfMonth.setDate(1);
    firstDayOfMonth.setHours(0, 0, 0, 0);
    const monthStart = firstDayOfMonth.toISOString();

    const [balanceRes, inflowsRes, outflowsRes] = await Promise.all([
      admin.from('bank_accounts').select('balance').eq('company_id', ctx.company_id),
      admin.from('payments').select('amount')
        .eq('company_id', ctx.company_id).eq('status', 'confirmed')
        .eq('direction', 'inbound').gte('confirmed_at', monthStart),
      admin.from('payments').select('amount')
        .eq('company_id', ctx.company_id).eq('status', 'confirmed')
        .eq('direction', 'outbound').gte('confirmed_at', monthStart),
    ]);

    const saldo = (balanceRes.data || []).reduce((s, a) => s + (a.balance || 0), 0);
    const ingresos = (inflowsRes.data || []).reduce((s, p) => s + (p.amount || 0), 0);
    const egresos = (outflowsRes.data || []).reduce((s, p) => s + (p.amount || 0), 0);

    return Response.json({
      data: {
        saldo_actual: saldo,
        ingresos_mes: ingresos,
        egresos_mes: egresos,
        flujo_neto: ingresos - egresos,
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
