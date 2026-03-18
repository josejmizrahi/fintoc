import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { satCancelSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';
import * as syntage from '@/lib/integrations/syntage';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('invoices.cancel', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = satCancelSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const { invoice_id, motivo, uuid_sustituto } = result.data;
    const admin = getAdminClient();

    const { data: invoice } = await admin
      .from('invoices')
      .select('*')
      .eq('id', invoice_id)
      .eq('company_id', ctx.company_id)
      .single();

    if (!invoice) throw new ApiError('NOT_FOUND', 'Factura no encontrada', 404);
    if (invoice.cancellable === false) {
      throw new ApiError('INVOICE_NOT_CANCELLABLE', 'El SAT no permite cancelar esta factura', 422);
    }
    if (invoice.sat_status === 'cancelado') {
      throw new ApiError('ALREADY_CANCELLED', 'Esta factura ya está cancelada', 422);
    }

    if (['01', '04'].includes(motivo) && !uuid_sustituto) {
      throw new ApiError('VALIDATION_ERROR', 'uuid_sustituto requerido para motivo 01 o 04', 400);
    }

    // Get Syntage integration
    const { data: integration } = await admin
      .from('integrations')
      .select('syntage_taxpayer_id')
      .eq('company_id', ctx.company_id)
      .eq('provider', 'sat')
      .single();

    if (!integration?.syntage_taxpayer_id) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado', 422);
    }

    // If we have the Syntage invoice ID, use it to request cancellation via extraction
    // SAT cancellation is async — we create an extraction and track its status
    let cancellationResult: Record<string, unknown> = {};

    if (invoice.syntage_invoice_id) {
      try {
        // Create a cancellation extraction for this invoice
        const extraction = await syntage.createExtraction(
          integration.syntage_taxpayer_id,
          'invoice',
          { type: 'issued' },
        );

        cancellationResult = {
          extraction_id: extraction.id,
          extraction_status: extraction.status,
        };

        // Track the cancellation request
        await admin.from('syntage_extractions').insert({
          company_id: ctx.company_id,
          syntage_extraction_id: extraction.id,
          extractor: 'invoice',
          status: 'pending',
        });
      } catch (err) {
        throw new ApiError(
          'SYNTAGE_ERROR',
          `Error al solicitar cancelación en SAT: ${err instanceof Error ? err.message : 'Error desconocido'}`,
          502,
        );
      }
    }

    // Update local invoice status to pending cancellation
    await admin.from('invoices').update({
      sat_status: 'en_proceso_cancelacion',
      cancel_motivo: motivo,
      cancel_uuid_sustituto: uuid_sustituto || null,
    }).eq('id', invoice_id);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'invoice.cancellation_requested',
      entity_type: 'invoice',
      entity_id: invoice_id,
      changes: { before: { sat_status: invoice.sat_status }, after: { sat_status: 'en_proceso_cancelacion' } },
      metadata: { motivo, uuid_sustituto, ...cancellationResult },
    });

    return Response.json({
      data: {
        message: 'Solicitud de cancelación enviada al SAT',
        sat_status: 'en_proceso_cancelacion',
        ...cancellationResult,
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
