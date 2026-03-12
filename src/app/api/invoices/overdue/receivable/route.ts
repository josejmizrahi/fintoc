import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('invoices.read', async (_req, ctx) => {
    const url = new URL(_req.url);
    const days = parseInt(url.searchParams.get('days') || '0', 10);
    const admin = getAdminClient();
    const today = new Date().toISOString().slice(0, 10);

    let query = admin
      .from('invoices')
      .select('*, customers:customer_id(id, name, rfc)')
      .eq('company_id', ctx.company_id)
      .eq('type', 'receivable')
      .lt('date_due', today)
      .gt('amount_residual', 0);

    if (days > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      query = query.gte('date_due', cutoff.toISOString().slice(0, 10));
    }

    query = query.order('date_due', { ascending: true });
    const { data } = await query;

    return Response.json(data || []);
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
