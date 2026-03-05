import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { paymentExecuteBatchSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';
import { createTransfer } from '@/lib/integrations/fintoc';
import { decrypt } from '@/lib/utils/crypto';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('payments.execute', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = paymentExecuteBatchSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const { payment_ids } = result.data;
    const admin = getAdminClient();

    // Validate all payments first
    const { data: payments } = await admin
      .from('payments')
      .select('*, vendors:vendor_id(efos_status, name, clabe)')
      .in('id', payment_ids)
      .eq('company_id', ctx.company_id);

    if (!payments || payments.length !== payment_ids.length) {
      throw new ApiError('NOT_FOUND', 'Algunos pagos no fueron encontrados', 404);
    }

    // Pre-validate all payments
    const errors: { payment_id: string; error: string }[] = [];
    for (const p of payments) {
      if (!['draft', 'pending'].includes(p.status)) {
        errors.push({ payment_id: p.id, error: `Status '${p.status}' no ejecutable` });
      }
      if (p.vendors?.efos_status === 'definitivo') {
        errors.push({ payment_id: p.id, error: 'Proveedor en lista EFOS' });
      }
    }

    if (errors.length > 0) {
      throw new ApiError('VALIDATION_ERROR', 'Algunos pagos no son validos', 422, { errors });
    }

    // Get Fintoc key
    let fintocSecretKey = process.env.FINTOC_SECRET_KEY;
    const { data: integration } = await admin
      .from('integrations')
      .select('config_encrypted')
      .eq('company_id', ctx.company_id)
      .eq('provider', 'fintoc')
      .single();

    if (integration?.config_encrypted) {
      try {
        const config = decrypt(integration.config_encrypted);
        fintocSecretKey = config.secret_key as string;
      } catch { /* use env */ }
    }

    if (!fintocSecretKey) throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Fintoc no configurado', 422);

    // Execute one by one with delay
    const results: { payment_id: string; status: string; error?: string }[] = [];
    let succeeded = 0;
    let failed = 0;

    for (const payment of payments) {
      try {
        const transfer = (await createTransfer({
          amount: Math.round(payment.amount * 100),
          currency: 'MXN',
          destination_account: { number: payment.clabe },
          concept: payment.concept,
          reference_id: payment.reference || undefined,
        }, fintocSecretKey)) as { id: string };

        await admin.from('payments').update({
          status: 'processing',
          fintoc_transfer_id: transfer.id,
          executed_at: new Date().toISOString(),
        }).eq('id', payment.id);

        await writeAuditLog({
          company_id: ctx.company_id,
          user_id: ctx.user_id,
          action: 'payment.executed',
          entity_type: 'payment',
          entity_id: payment.id,
          metadata: { batch: true, fintoc_transfer_id: transfer.id },
        });

        results.push({ payment_id: payment.id, status: 'processing' });
        succeeded++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Error desconocido';
        await admin.from('payments').update({
          status: 'failed',
          fintoc_error: errorMsg,
        }).eq('id', payment.id);

        results.push({ payment_id: payment.id, status: 'failed', error: errorMsg });
        failed++;
      }

      // Delay between payments
      if (payments.indexOf(payment) < payments.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return Response.json({
      data: {
        total: payment_ids.length,
        succeeded,
        failed,
        results,
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'batch' });
