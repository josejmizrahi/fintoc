import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { satExtractSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import * as syntage from '@/lib/integrations/syntage';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('sat.extract', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = satExtractSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const { extractor, date_from, date_to } = result.data as {
      extractor: syntage.Extractor;
      date_from?: string;
      date_to?: string;
    };
    const admin = getAdminClient();

    const { data: integration } = await admin
      .from('integrations')
      .select('syntage_taxpayer_id')
      .eq('company_id', ctx.company_id)
      .eq('provider', 'syntage')
      .single();

    if (!integration?.syntage_taxpayer_id) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado', 422);
    }

    const extraction = (await syntage.createExtraction(
      integration.syntage_taxpayer_id,
      extractor,
      { dateFrom: date_from, dateTo: date_to }
    )) as { id: string };

    // Track extraction
    await admin.from('syntage_extractions').insert({
      company_id: ctx.company_id,
      syntage_extraction_id: extraction.id,
      extractor,
      status: 'pending',
    });

    return Response.json({ data: extraction }, { status: 201 });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
