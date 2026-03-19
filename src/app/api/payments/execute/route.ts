import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { paymentExecuteSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';
import { createTransfer } from '@/lib/integrations/fintoc';
import { decrypt } from '@/lib/utils/crypto';
import { sendPaymentConfirmation } from '@/lib/email';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('payments.execute', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = paymentExecuteSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'payment_id invalido', 400);

    const { payment_id } = result.data;
    const admin = getAdminClient();

    // Fetch payment and company's Fintoc account
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

    if (!['draft', 'pending', 'scheduled', 'approved'].includes(payment.status)) {
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
      const config = decrypt(integration.config_encrypted as string | Buffer) as Record<string, string> | null;
      if (config?.secret_key) fintocSecretKey = config.secret_key;
    }

    if (!fintocSecretKey) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Fintoc no configurado', 422);
    }

    // Get the company's Fintoc account_id for outbound transfers
    const { data: bankAccount } = await admin
      .from('bank_accounts')
      .select('fintoc_account_id')
      .eq('company_id', ctx.company_id)
      .not('fintoc_account_id', 'is', null)
      .limit(1)
      .single();

    if (!bankAccount?.fintoc_account_id) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'No hay cuenta bancaria vinculada a Fintoc', 422);
    }

    // Deterministic idempotency key prevents double-charges on retry
    const idempotencyKey = `payment_${payment_id}_${ctx.company_id}`;

    try {
      // Call Fintoc v2 to create transfer
      const transfer = (await createTransfer({
        amount: Math.round(payment.amount * 100), // Fintoc expects centavos
        currency: 'MXN',
        counterparty: {
          number: payment.clabe,
        },
        comment: payment.concept,
        account_id: bankAccount.fintoc_account_id,
        reference_id: payment.reference || undefined,
      }, fintocSecretKey, idempotencyKey)) as { id: string };

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

      // Send email notification (non-blocking)
      if (ctx.email) {
        const { data: company } = await admin.from('companies').select('name').eq('id', ctx.company_id).single();
        sendPaymentConfirmation({
          to: ctx.email,
          vendorName: payment.vendors?.name || payment.partner_name || 'Proveedor',
          amount: payment.amount,
          reference: payment.reference || transfer.id,
          concept: payment.concept || '',
          companyName: company?.name || 'Quimibond',
        }).catch(() => { /* non-blocking */ });
      }

      return Response.json({ data: updated });
    } catch (err) {
      if (err instanceof ApiError) throw err;

      // Before marking as failed, check if the transfer actually went through
      // (protects against: transfer succeeds → DB update fails → catch marks as failed)
      const { data: currentPayment } = await admin
        .from('payments')
        .select('fintoc_transfer_id')
        .eq('id', payment_id)
        .single();

      if (currentPayment?.fintoc_transfer_id) {
        // Transfer exists — don't overwrite as failed, it's actually processing
        throw new ApiError('INTERNAL_ERROR', 'Pago enviado pero error al actualizar estado. Contacta soporte.', 500);
      }

      // No transfer was created — safe to mark as failed
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
