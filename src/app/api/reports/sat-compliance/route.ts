import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('reports.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data: invoices } = await admin.from('invoices').select('sat_status, efos_status, uuid')
      .eq('company_id', ctx.company_id);

    const total = invoices?.length || 0;
    const validated = invoices?.filter(i => i.sat_status && i.sat_status !== 'no_validado').length || 0;
    const cancelled = invoices?.filter(i => i.sat_status === 'cancelado').length || 0;
    const efosDetected = invoices?.filter(i => i.efos_status).length || 0;
    const missingUuid = invoices?.filter(i => !i.uuid).length || 0;

    return Response.json({
      data: {
        total_invoices: total,
        validated_percent: total > 0 ? Math.round((validated / total) * 100) : 0,
        cancelled_count: cancelled,
        efos_detected: efosDetected,
        missing_uuid: missingUuid,
      },
    });
  }))(req, { params: Promise.resolve({}) });
});
