import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { syncFintoc, getFintocKeyForCompany } from '@/lib/integrations/sync-engine';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('sync.execute', async (_req, ctx) => {
    const companyId = String(ctx.company_id);
    const secretKey = await getFintocKeyForCompany(companyId);
    const result = await syncFintoc(companyId, secretKey);

    return Response.json({
      data: {
        status: result.status,
        records_synced: result.recordsSynced,
        records_failed: result.recordsFailed,
        details: result.details,
        errors: result.errors.length > 0
          ? result.errors.map(e => ({ entity: e.entity, message: e.message }))
          : undefined,
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'batch' });
