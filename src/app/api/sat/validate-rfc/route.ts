import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { satValidateRfcSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import * as syntage from '@/lib/integrations/syntage';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('sat.validate', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = satValidateRfcSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'RFC invalido', 400);

    const { rfc } = result.data;

    const { data: integration } = await getAdminClient()
      .from('integrations')
      .select('syntage_taxpayer_id')
      .eq('company_id', ctx.company_id)
      .eq('provider', 'sat')
      .single();

    if (!integration?.syntage_taxpayer_id) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado', 422);
    }

    const taxStatus = (await syntage.getTaxStatus(integration.syntage_taxpayer_id)) as Record<string, unknown>;

    // Update vendor if exists
    const admin = getAdminClient();
    await admin.from('vendors')
      .update({ rfc_validated: true })
      .eq('company_id', ctx.company_id)
      .eq('rfc', rfc.toUpperCase());

    return Response.json({
      data: {
        rfc: rfc.toUpperCase(),
        valid: true,
        tax_status: taxStatus,
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
