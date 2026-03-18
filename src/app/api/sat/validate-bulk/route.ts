import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { satValidateBulkSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import * as syntage from '@/lib/integrations/syntage';
import { writeAuditLog } from '@/lib/middleware/audit';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('sat.validate', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = satValidateBulkSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

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

    // Get invoices to validate
    let query = admin.from('invoices').select('*').eq('company_id', ctx.company_id);

    if (result.data.invoice_ids && result.data.invoice_ids.length > 0) {
      query = query.in('id', result.data.invoice_ids);
    } else {
      query = query.eq('sat_status', 'no_validado');
    }

    const { data: invoices } = await query;
    if (!invoices || invoices.length === 0) {
      return Response.json({ data: { total: 0, validated: 0, errors: 0, changed: [] } });
    }

    let validated = 0;
    let errors = 0;
    const changed: { invoice_id: string; old_status: string; new_status: string }[] = [];

    for (const invoice of invoices) {
      try {
        if (!invoice.uuid) {
          errors++;
          continue;
        }

        const invoiceResults = (await syntage.getInvoices(integration.syntage_taxpayer_id, {
          uuid: [invoice.uuid],
        })) as { data?: Record<string, unknown>[] };

        if (invoiceResults?.data && invoiceResults.data.length > 0) {
          const cfdi = invoiceResults.data[0];
          const rawStatus = (cfdi.status as string) || '';
          const newStatus = rawStatus === 'Vigente' ? 'vigente' :
                           rawStatus === 'Cancelado' ? 'cancelado' :
                           rawStatus.toLowerCase() || 'no_validado';

          if (newStatus !== invoice.sat_status) {
            changed.push({
              invoice_id: invoice.id,
              old_status: invoice.sat_status || 'no_validado',
              new_status: newStatus,
            });
          }

          await admin.from('invoices').update({
            sat_status: newStatus,
            efos_status: (cfdi.efos_status as string) || null,
            cancellable: (cfdi.cancellable as boolean) || null,
            validated_at: new Date().toISOString(),
          }).eq('id', invoice.id);

          validated++;
        } else {
          errors++;
        }
      } catch {
        errors++;
      }
    }

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'sat.bulk_validated',
      entity_type: 'invoice',
      entity_id: 0,
      metadata: { total: invoices.length, validated, errors, changed_count: changed.length },
    });

    return Response.json({
      data: { total: invoices.length, validated, errors, changed },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'batch' });
