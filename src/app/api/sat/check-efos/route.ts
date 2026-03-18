import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { satCheckEfosSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import * as syntage from '@/lib/integrations/syntage';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('sat.validate', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = satCheckEfosSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'RFC invalido', 400);

    const { rfc } = result.data;
    const normalizedRfc = rfc.toUpperCase();
    const admin = getAdminClient();

    // Check local DB first
    const { data: vendor } = await admin
      .from('vendors')
      .select('id, efos_status')
      .eq('company_id', ctx.company_id)
      .eq('rfc', normalizedRfc)
      .single();

    let efosStatus = vendor?.efos_status || null;
    let efosResult: syntage.EfosResult | null = null;
    let source: 'local' | 'syntage' = 'local';

    // If no local EFOS data, query Syntage live
    if (!efosStatus) {
      try {
        const { data: integration } = await admin
          .from('integrations')
          .select('syntage_taxpayer_id')
          .eq('company_id', ctx.company_id)
          .eq('provider', 'sat')
          .single();

        if (integration?.syntage_taxpayer_id) {
          // Search for invoices from this RFC to check EFOS
          const invoices = await syntage.getInvoices(integration.syntage_taxpayer_id, {
            issuerRfc: normalizedRfc,
            itemsPerPage: 1,
          });

          if (invoices.length > 0 && invoices[0].efos_validation) {
            efosResult = syntage.parseEfosStatus(invoices[0].efos_validation);
            efosStatus = efosResult.isBlocked ? 'definitivo' :
                        efosResult.isRisky ? 'presunto' :
                        efosResult.status === 'acquitted' ? 'desvirtuado' :
                        efosResult.status === 'favorable_sentence' ? 'sentencia_favorable' :
                        null;
            source = 'syntage';

            // Persist to vendor if exists
            if (vendor && efosStatus) {
              await admin.from('vendors').update({ efos_status: efosStatus }).eq('id', vendor.id);
            }
          }
        }
      } catch {
        // Syntage unavailable — return local data only
      }
    }

    // EFOS codes: 200=clean, 201=presunto, 202=desvirtuado, 203=definitivo, 204=favorable
    let efosCode = 200;
    if (efosStatus === 'presunto') efosCode = 201;
    else if (efosStatus === 'desvirtuado') efosCode = 202;
    else if (efosStatus === 'definitivo') efosCode = 203;
    else if (efosStatus === 'sentencia_favorable') efosCode = 204;

    return Response.json({
      data: {
        rfc: normalizedRfc,
        efos_status: efosStatus,
        efos_code: efosCode,
        source,
        is_blocked: efosCode === 203,
        is_risky: efosCode === 201,
        label: efosResult?.label || (efosStatus ? `Estado EFOS: ${efosStatus}` : 'Sin información EFOS'),
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
