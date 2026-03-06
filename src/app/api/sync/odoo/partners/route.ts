import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { syncOdooPartners } from '@/lib/integrations/sync-engine';

/** POST /api/sync/odoo/partners — sync vendors and customers from Odoo to cache (for lists). */
export const POST = createHandler(async (req) => {
  return withAuth(withRbac('sync.execute', async (_req, ctx) => {
    const companyId = String(ctx.company_id);
    const result = await syncOdooPartners(companyId);

    return Response.json({
      data: {
        vendors_synced: result.vendors,
        customers_synced: result.customers,
        errors: result.errors.length > 0 ? result.errors : undefined,
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'batch' });
