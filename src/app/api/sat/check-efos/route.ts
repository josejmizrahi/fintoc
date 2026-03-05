import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { satCheckEfosSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('sat.validate', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = satCheckEfosSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'RFC invalido', 400);

    const { rfc } = result.data;
    const admin = getAdminClient();

    // Check if vendor exists and get EFOS status
    const { data: vendor } = await admin
      .from('vendors')
      .select('efos_status')
      .eq('company_id', ctx.company_id)
      .eq('rfc', rfc.toUpperCase())
      .single();

    // EFOS codes: 200=clean, 201=presunto, 202=desvirtuado, 203=definitivo, 204=favorable
    const efosStatus = vendor?.efos_status || null;
    let efosCode = 200;
    if (efosStatus === 'presunto') efosCode = 201;
    else if (efosStatus === 'definitivo') efosCode = 203;

    return Response.json({
      data: { efos_status: efosStatus, efos_code: efosCode },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
