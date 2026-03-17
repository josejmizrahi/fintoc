import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';
import { z } from 'zod';

const recordPaymentSchema = z.object({
  invoice_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).transform(v => typeof v === 'string' ? parseInt(v, 10) : v),
  amount: z.number().positive('Monto debe ser mayor a 0'),
  reference: z.string().max(50).optional(),
});

// POST /api/collections/record-payment — Record a manual inbound payment for a receivable invoice
export const POST = createHandler(async (req) => {
  return withAuth(withRbac('collections.write', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = recordPaymentSchema.safeParse(body);
    if (!result.success) {
      throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400, {
        fields: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const { invoice_id, amount, reference } = result.data;
    const admin = getAdminClient();

    // Validate invoice exists and belongs to the company
    const { data: invoice, error: invError } = await admin
      .from('invoices')
      .select('*')
      .eq('id', invoice_id)
      .eq('company_id', ctx.company_id)
      .single();

    if (invError || !invoice) {
      throw new ApiError('NOT_FOUND', 'Factura no encontrada', 404);
    }

    if (invoice.amount_residual <= 0) {
      throw new ApiError('VALIDATION_ERROR', 'Factura ya esta pagada', 422);
    }

    if (amount > invoice.amount_residual) {
      throw new ApiError('VALIDATION_ERROR', `Monto excede el saldo pendiente ($${invoice.amount_residual})`, 422);
    }

    // Create inbound payment record
    const { data: payment, error: createError } = await admin
      .from('payments')
      .insert({
        company_id: ctx.company_id,
        direction: 'inbound',
        invoice_id,
        amount,
        currency: invoice.currency || 'MXN',
        beneficiary_name: invoice.partner_name || invoice.issuer_rfc || null,
        concept: `Pago recibido - ${invoice.name || invoice.invoice_number || ''}`.trim(),
        reference: reference || null,
        status: 'confirmed',
        created_by: ctx.user_id,
        executed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError) {
      throw new ApiError('INTERNAL_ERROR', 'Error al registrar pago', 500);
    }

    // Update invoice amounts
    const newAmountPaid = (invoice.amount_paid || 0) + amount;
    const newAmountResidual = (invoice.amount_total || 0) - newAmountPaid;

    await admin.from('invoices').update({
      amount_paid: newAmountPaid,
      amount_residual: Math.max(0, newAmountResidual),
    }).eq('id', invoice_id);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'collection.payment_recorded',
      entity_type: 'payment',
      entity_id: payment.id,
      changes: { after: payment },
    });

    return Response.json({ data: payment }, { status: 201 });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
