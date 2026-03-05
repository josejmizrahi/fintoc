import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { paymentExecuteSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';
import { createTransfer } from '@/lib/integrations/fintoc';
import { decrypt } from '@/lib/utils/crypto';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('payments.execute', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = paymentExecuteSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'payment_id invalido', 400);

    const { payment_id } = result.data;
    const admin = getAdminClient();

    // Fetch payment
    const { data: payment } = await admin
      .from('payments')
      .select('*, vendors:vendor_id(efos_status, name)')
      .eq('id', payment_id)
      .eq('company_id', ctx.company_id)
      .single();

    if (!payment) throw new ApiError('NOT_FOUND', 'Pago no encontrado', 404);

    // Idempotency: if already processing, return current state
    if (payment.status === 'processing') {
      return Response.json({ data: payment });
    }

    if (!['draft', 'pending'].includes(payment.status)) {
      throw new ApiError('PAYMENT_NOT_EXECUTABLE', `Pago en status '${payment.status}' no es ejecutable`, 422);
    }

    // Re-verify vendor EFOS
    if (payment.vendors?.efos_status === 'definitivo') {
      throw new ApiError('VENDOR_EFOS_BLOCKED', 'Proveedor en lista EFOS definitiva', 422);
    }

    // Get Fintoc credentials
    let fintocSecretKey = process.env.FINTOC_SECRET_KEY;

    const { data: integration } = await admin
      .from('integrations')
      .select('config_encrypted, status')
      .eq('company_id', ctx.company_id)
      .eq('provider', 'fintoc')
      .single();

    if (integration?.config_encrypted) {
      try {
        const config = decrypt(integration.config_encrypted);
        fintocSecretKey = config.secret_key as string;
      } catch {
        // Fall back to env variable
      }
    }

    if (!fintocSecretKey) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Fintoc no configurado', 422);
    }

    try {
      // Call Fintoc to create transfer
      const transfer = (await createTransfer({
        amount: Math.round(payment.amount * 100), // Fintoc expects centavos
        currency: 'MXN',
        destination_account: {
          number: payment.clabe,
        },
        concept: payment.concept,
        reference_id: payment.reference || undefined,
      }, fintocSecretKey)) as { id: string };

      // Update payment status
      const { data: updated, error } = await admin
        .from('payments')
        .update({
          status: 'processing',
          fintoc_transfer_id: transfer.id,
          executed_at: new Date().toISOString(),
        })
        .eq('id', payment_id)
        .select()
        .single();

      if (error) throw new ApiError('INTERNAL_ERROR', 'Error al actualizar pago', 500);

      await writeAuditLog({
        company_id: ctx.company_id,
        user_id: ctx.user_id,
        action: 'payment.executed',
        entity_type: 'payment',
        entity_id: payment_id,
        metadata: { fintoc_transfer_id: transfer.id },
      });

      return Response.json({ data: updated });
    } catch (err) {
      if (err instanceof ApiError) throw err;

      // Update payment with error
      await admin
        .from('payments')
        .update({
          status: 'failed',
          fintoc_error: err instanceof Error ? err.message : 'Error desconocido',
        })
        .eq('id', payment_id);

      await writeAuditLog({
        company_id: ctx.company_id,
        user_id: ctx.user_id,
        action: 'payment.failed',
        entity_type: 'payment',
        entity_id: payment_id,
        metadata: { error: err instanceof Error ? err.message : 'Unknown' },
      });

      throw new ApiError('FINTOC_ERROR', 'Error al procesar pago con Fintoc', 502);
    }
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
