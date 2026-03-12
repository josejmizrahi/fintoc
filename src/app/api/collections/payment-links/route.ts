import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { paymentLinkSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { createPaymentIntent } from '@/lib/integrations/fintoc';
import { writeAuditLog } from '@/lib/middleware/audit';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('collections.write', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = paymentLinkSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const { invoice_id, amount } = result.data;
    const admin = getAdminClient();

    const { data: invoice } = await admin
      .from('invoices')
      .select('*')
      .eq('id', invoice_id)
      .eq('company_id', ctx.company_id)
      .eq('type', 'receivable')
      .single();

    if (!invoice) throw new ApiError('NOT_FOUND', 'Factura no encontrada', 404);
    if ((invoice.amount_residual || 0) <= 0) throw new ApiError('VALIDATION_ERROR', 'Factura sin saldo pendiente', 422);

    const paymentAmount = amount || invoice.amount_residual;

    // Get company bank account
    const { data: bankAccount } = await admin
      .from('bank_accounts')
      .select('clabe')
      .eq('company_id', ctx.company_id)
      .limit(1)
      .single();

    if (!bankAccount?.clabe) throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Sin cuenta bancaria configurada', 422);

    const intent = await createPaymentIntent({
      amount: Math.round(paymentAmount * 100),
      currency: 'MXN',
      recipient_account: { number: bankAccount.clabe },
    });

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'collection.payment_link_created',
      entity_type: 'invoice',
      entity_id: invoice_id,
      metadata: { payment_intent_id: intent.id, amount: paymentAmount },
    });

    return Response.json({
      data: {
        payment_link: intent.widget_token || intent.id,
        fintoc_payment_intent_id: intent.id,
      },
    }, { status: 201 });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
