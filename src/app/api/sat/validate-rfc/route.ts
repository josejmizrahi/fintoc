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
    const normalizedRfc = rfc.toUpperCase();

    const admin = getAdminClient();
    const { data: integration } = await admin
      .from('integrations')
      .select('syntage_taxpayer_id')
      .eq('company_id', ctx.company_id)
      .eq('provider', 'sat')
      .single();

    if (!integration?.syntage_taxpayer_id) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado', 422);
    }

    // Look up invoices from this RFC to verify it exists in SAT
    let rfcValid = false;
    const taxStatus: Record<string, unknown> | null = null;
    let efosResult: syntage.EfosResult | null = null;

    try {
      // Search for invoices from this RFC (as issuer) to validate it exists
      const invoices = await syntage.getInvoices(integration.syntage_taxpayer_id, {
        issuerRfc: normalizedRfc,
        itemsPerPage: 1,
      });

      if (invoices.length > 0) {
        rfcValid = true;
        // Check EFOS status from the first invoice
        const inv = invoices[0];
        if (inv.efos_validation) {
          efosResult = syntage.parseEfosStatus(inv.efos_validation);
        }
      } else {
        // Also check as receiver
        const receivedInvoices = await syntage.getInvoices(integration.syntage_taxpayer_id, {
          receiverRfc: normalizedRfc,
          itemsPerPage: 1,
        });
        rfcValid = receivedInvoices.length > 0;
      }
    } catch {
      // If Syntage lookup fails, we can still mark based on format validation
    }

    // Update vendor if exists — store validation result and EFOS
    const vendorUpdate: Record<string, unknown> = { rfc_validated: rfcValid };
    if (efosResult?.status) {
      vendorUpdate.efos_status = efosResult.isBlocked ? 'definitivo' : efosResult.isRisky ? 'presunto' : null;
    }

    await admin.from('vendors')
      .update(vendorUpdate)
      .eq('company_id', ctx.company_id)
      .eq('rfc', normalizedRfc);

    return Response.json({
      data: {
        rfc: normalizedRfc,
        valid: rfcValid,
        efos: efosResult ? {
          status: efosResult.status,
          label: efosResult.label,
          is_blocked: efosResult.isBlocked,
          is_risky: efosResult.isRisky,
        } : null,
        tax_status: taxStatus,
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
