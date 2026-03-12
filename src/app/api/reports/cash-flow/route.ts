import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('reports.read', async (_req, ctx) => {
    const url = new URL(_req.url);
    const period = url.searchParams.get('period') || '30d';
    const admin = getAdminClient();

    const days = period === '7d' ? 7 : period === '90d' ? 90 : period === '12m' ? 365 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data: payments } = await admin.from('payments').select('amount, direction, confirmed_at')
      .eq('company_id', ctx.company_id).eq('status', 'confirmed').gte('confirmed_at', startDate.toISOString());

    // Group by date
    const dateMap = new Map<string, { inflows: number; outflows: number }>();
    for (const p of (payments || [])) {
      const date = p.confirmed_at ? new Date(p.confirmed_at).toISOString().split('T')[0] : '';
      if (!date) continue;
      if (!dateMap.has(date)) dateMap.set(date, { inflows: 0, outflows: 0 });
      const entry = dateMap.get(date)!;
      if (p.direction === 'inbound') entry.inflows += p.amount || 0;
      else entry.outflows += p.amount || 0;
    }

    const result = Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { inflows, outflows }]) => ({ date, inflows, outflows, net: inflows - outflows }));

    return Response.json({ data: result });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
