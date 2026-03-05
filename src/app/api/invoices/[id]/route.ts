import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { invoiceUpdateSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

// GET /api/invoices/:id
export const GET = createHandler(async (req, params) => {
  return withAuth(withRbac('invoices.read', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data: invoice, error } = await admin
      .from('invoices')
      .select('*, vendors:vendor_id(*), customers:customer_id(*)')
      .eq('id', params.id)
      .eq('company_id', ctx.company_id)
      .single();

    if (error || !invoice) throw new ApiError('NOT_FOUND', 'Factura no encontrada', 404);

    // Get related payments
    const { data: paymentLinks } = await admin
      .from('invoice_payments')
      .select('*, payments:payment_id(*)')
      .eq('invoice_id', params.id);

    return Response.json({
      data: { ...invoice, payments: paymentLinks || [] },
    });
  }))(req, { params: Promise.resolve(params) });
});

// PUT /api/invoices/:id
export const PUT = createHandler(async (req, params) => {
  return withAuth(withRbac('invoices.update', async (_req, ctx) => {
    const admin = getAdminClient();
    const { data: invoice } = await admin
      .from('invoices')
      .select('*')
      .eq('id', params.id)
      .eq('company_id', ctx.company_id)
      .single();

    if (!invoice) throw new ApiError('NOT_FOUND', 'Factura no encontrada', 404);

    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = invoiceUpdateSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const { data: updated, error } = await admin
      .from('invoices')
      .update(result.data)
      .eq('id', params.id)
      .select()
      .single();

    if (error) throw new ApiError('INTERNAL_ERROR', 'Error al actualizar factura', 500);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'invoice.updated',
      entity_type: 'invoice',
      entity_id: params.id,
      changes: { before: invoice, after: updated },
    });

    return Response.json({ data: updated });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });
