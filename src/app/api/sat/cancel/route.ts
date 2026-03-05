import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { satCancelSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

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

    if (['01', '04'].includes(motivo) && !uuid_sustituto) {
      throw new ApiError('VALIDATION_ERROR', 'uuid_sustituto requerido para motivo 01 o 04', 400);
    }

    // Update invoice status
    await admin.from('invoices').update({
      sat_status: 'cancelado',
    }).eq('id', invoice_id);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'invoice.cancelled',
      entity_type: 'invoice',
      entity_id: invoice_id,
      changes: { before: { sat_status: invoice.sat_status }, after: { sat_status: 'cancelado' } },
      metadata: { motivo, uuid_sustituto },
    });

    return Response.json({
      data: { message: 'Solicitud de cancelacion procesada', sat_status: 'cancelado' },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
