import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { syncSat, getSyntageTaxpayerForCompany } from '@/lib/integrations/sync-engine';
import type { Extractor } from '@/lib/integrations/syntage';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('sync.execute', async (request, ctx) => {
    const companyId = String(ctx.company_id);
    const taxpayerId = await getSyntageTaxpayerForCompany(companyId);

    let extractors: Extractor[] | undefined;
    let dateFrom: string | undefined;
    let dateTo: string | undefined;

    try {
      const body = await request.json() as {
        extractors?: Extractor[];
        date_from?: string;
        date_to?: string;
      };
      extractors = body.extractors;
      dateFrom = body.date_from;
      dateTo = body.date_to;
    } catch {
      // No body — use defaults
    }

    const result = await syncSat(companyId, taxpayerId, {
      extractors,
      dateFrom,
      dateTo,
    });

    return Response.json({
      data: {
        status: result.status,
        extractions: result.extractions,
        errors: result.errors.length > 0
          ? result.errors.map(e => ({ entity: e.entity, message: e.message }))
          : undefined,
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'batch' });
