import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { verifyClabeSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { verifyCLABE } from '@/lib/integrations/fintoc';
import { writeAuditLog } from '@/lib/middleware/audit';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('vendors.write', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = verifyClabeSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'vendor_id invalido', 400);

    const admin = getAdminClient();
    const { data: vendor } = await admin
      .from('vendors')
      .select('*')
      .eq('id', result.data.vendor_id)
      .eq('company_id', ctx.company_id)
      .single();

    if (!vendor) throw new ApiError('NOT_FOUND', 'Proveedor no encontrado', 404);
    if (!vendor.clabe) throw new ApiError('VENDOR_NO_CLABE', 'Proveedor no tiene CLABE', 422);

    await verifyCLABE(vendor.clabe);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'vendor.clabe_verification_initiated',
      entity_type: 'vendor',
      entity_id: result.data.vendor_id,
      metadata: { clabe: vendor.clabe },
    });

    return Response.json({
      data: { message: 'Verificacion de CLABE iniciada. Resultado en 1-2 dias.' },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
