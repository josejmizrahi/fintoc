import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { paymentUpdateSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

// GET /api/payments/:id
export const GET = createHandler(async (req, params) => {
  return withAuth(withRbac('payments.read', async (_req, ctx) => {
    const admin = getAdminClient();

    const { data: payment, error } = await admin
      .from('payments')
      .select('*, vendors:vendor_id(*), invoices:invoice_id(*)')
      .eq('id', params.id)
      .eq('company_id', ctx.company_id)
      .single();

    if (error || !payment) throw new ApiError('NOT_FOUND', 'Pago no encontrado', 404);

    // Get audit trail
    const { data: audit } = await admin
      .from('audit_log')
      .select('*')
      .eq('entity_type', 'payment')
      .eq('entity_id', params.id)
      .order('created_at', { ascending: true });

    // Build timeline
    const timeline = (audit || []).map(entry => ({
      action: entry.action,
      user_id: entry.user_id,
      timestamp: entry.created_at,
      details: entry.changes,
    }));

    return Response.json({
      data: { ...payment, audit: audit || [], timeline },
    });
  }))(req, { params: Promise.resolve(params) });
});

// PUT /api/payments/:id
export const PUT = createHandler(async (req, params) => {
  return withAuth(withRbac('payments.create', async (_req, ctx) => {
    const admin = getAdminClient();

    // Fetch payment
    const { data: payment } = await admin
      .from('payments')
      .select('*')
      .eq('id', params.id)
      .eq('company_id', ctx.company_id)
      .single();

    if (!payment) throw new ApiError('NOT_FOUND', 'Pago no encontrado', 404);
    if (payment.status !== 'draft') {
      throw new ApiError('PAYMENT_NOT_EXECUTABLE', 'Solo se pueden editar pagos en borrador', 422);
    }

    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = paymentUpdateSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const updates: Record<string, unknown> = {};
    const data = result.data;

    if (data.vendor_id) {
      const { data: vendor } = await admin
        .from('vendors')
        .select('name, clabe, efos_status')
        .eq('id', data.vendor_id)
        .eq('company_id', ctx.company_id)
        .single();

      if (!vendor) throw new ApiError('NOT_FOUND', 'Proveedor no encontrado', 404);
      if (vendor.efos_status === 'definitivo') throw new ApiError('VENDOR_EFOS_BLOCKED', 'Proveedor bloqueado EFOS', 422);
      if (!vendor.clabe) throw new ApiError('VENDOR_NO_CLABE', 'Proveedor sin CLABE', 422);

      updates.vendor_id = data.vendor_id;
      updates.beneficiary_name = vendor.name;
      updates.clabe = vendor.clabe;
    }

    if (data.amount) updates.amount = data.amount;
    if (data.concept) updates.concept = data.concept;
    if (data.reference !== undefined) updates.reference = data.reference;
    if (data.scheduled_date !== undefined) updates.scheduled_date = data.scheduled_date;

    const { data: updated, error } = await admin
      .from('payments')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single();

    if (error) throw new ApiError('INTERNAL_ERROR', 'Error al actualizar pago', 500);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'payment.updated',
      entity_type: 'payment',
      entity_id: params.id,
      changes: { before: payment, after: updated },
    });

    return Response.json({ data: updated });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });

// DELETE /api/payments/:id
export const DELETE = createHandler(async (req, params) => {
  return withAuth(withRbac('payments.cancel', async (_req, ctx) => {
    const admin = getAdminClient();

    const { data: payment } = await admin
      .from('payments')
      .select('*')
      .eq('id', params.id)
      .eq('company_id', ctx.company_id)
      .single();

    if (!payment) throw new ApiError('NOT_FOUND', 'Pago no encontrado', 404);
    if (!['draft', 'pending_approval'].includes(payment.status)) {
      throw new ApiError('PAYMENT_NOT_EXECUTABLE', 'Solo se pueden cancelar pagos en borrador o pendientes de aprobacion', 422);
    }

    const { error } = await admin
      .from('payments')
      .update({ status: 'cancelled' })
      .eq('id', params.id);

    if (error) throw new ApiError('INTERNAL_ERROR', 'Error al cancelar pago', 500);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'payment.cancelled',
      entity_type: 'payment',
      entity_id: params.id,
    });

    return new Response(null, { status: 204 });
  }))(req, { params: Promise.resolve(params) });
}, { rateLimit: 'write' });
