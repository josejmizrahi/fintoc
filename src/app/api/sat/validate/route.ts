import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { satValidateSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';
import * as syntage from '@/lib/integrations/syntage';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('sat.validate', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = satValidateSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'invoice_id invalido', 400);

    const { invoice_id } = result.data;
    const admin = getAdminClient();

    const { data: invoice } = await admin
      .from('invoices')
      .select('*')
      .eq('id', invoice_id)
      .eq('company_id', ctx.company_id)
      .single();

    if (!invoice) throw new ApiError('NOT_FOUND', 'Factura no encontrada', 404);

    // Get Syntage taxpayer ID (stored under provider='sat' in integrations table)
    const { data: integration } = await admin
      .from('integrations')
      .select('syntage_taxpayer_id')
      .eq('company_id', ctx.company_id)
      .eq('provider', 'sat')
      .single();

    if (!integration?.syntage_taxpayer_id) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado', 422);
    }

    // Look up invoice in Syntage by UUID
    let cfdiData: Record<string, unknown> | null = null;
    if (invoice.syntage_invoice_id) {
      cfdiData = (await syntage.getInvoiceDetail(invoice.syntage_invoice_id)) as Record<string, unknown>;
    } else if (invoice.uuid) {
      const invoices = (await syntage.getInvoices(integration.syntage_taxpayer_id, {
        uuid: [invoice.uuid],
      })) as { data?: Record<string, unknown>[] };

      if (invoices?.data && invoices.data.length > 0) {
        cfdiData = invoices.data[0];
      }
    }

    if (!cfdiData) {
      return Response.json({
        data: { sat_status: 'no_encontrado', efos_status: null, cancellable: null },
      });
    }

    const satStatus = (cfdiData.status as string) || 'no_validado';
    const efosStatus = (cfdiData.efos_status as string) || null;
    const cancellable = (cfdiData.cancellable as boolean) || null;

    // Update invoice
    await admin.from('invoices').update({
      sat_status: satStatus === 'active' ? 'vigente' : satStatus === 'cancelled' ? 'cancelado' : satStatus,
      efos_status: efosStatus,
      cancellable,
      validated_at: new Date().toISOString(),
      syntage_invoice_id: (cfdiData.id as string) || invoice.syntage_invoice_id,
    }).eq('id', invoice_id);

    // Update vendor EFOS if definitivo
    if (efosStatus === 'definitivo' && invoice.vendor_id) {
      await admin.from('vendors').update({ efos_status: 'definitivo' }).eq('id', invoice.vendor_id);
    }

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'invoice.validated',
      entity_type: 'invoice',
      entity_id: invoice_id,
      changes: { after: { sat_status: satStatus, efos_status: efosStatus } },
    });

    return Response.json({
      data: { sat_status: satStatus, efos_status: efosStatus, cancellable },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
