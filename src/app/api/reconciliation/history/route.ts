import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('reconciliation.read', async (_req, ctx) => {
    const admin = getAdminClient();

    const { data: history } = await admin
      .from('reconciliations')
      .select('id, type, period_start, period_end, matched_count, unmatched_count, discrepancy_count, result_summary, created_at')
      .eq('company_id', ctx.company_id)
      .order('created_at', { ascending: false })
      .limit(50);

    const records = (history || []).map((h) => ({
      id: h.id,
      type: h.type,
      reconciliation_type: h.type,
      period: `${h.period_start} — ${h.period_end}`,
      matched: h.matched_count,
      unmatched: h.unmatched_count,
      discrepancies: h.discrepancy_count,
      status: h.discrepancy_count > 0 ? 'discrepancies' : 'clean',
      created_at: h.created_at,
      result_summary: h.result_summary,
    }));

    return Response.json({ data: records });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
