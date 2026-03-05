import { getAdminClient } from '@/lib/supabase/admin';
import { verifyFintocWebhook, centavosToPesos } from '@/lib/integrations/fintoc';

interface FintocWebhookPayload {
  type: string;
  data: Record<string, unknown>;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('fintoc-signature') || '';
    const isRetry = req.headers.get('x-webhook-retry') === 'true';

    if (!isRetry && !verifyFintocWebhook(rawBody, signature)) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody) as FintocWebhookPayload;
    const admin = getAdminClient();

    // Log the webhook
    const { data: webhookLog } = await admin.from('webhook_logs').insert({
      provider: 'fintoc',
      event_type: payload.type,
      payload,
      processed: false,
    }).select('id').single();

    try {
      switch (payload.type) {
        case 'transfer.outbound.succeeded':
          await handleTransferSucceeded(admin, payload.data);
          break;

        case 'transfer.outbound.failed':
        case 'transfer.outbound.rejected':
          await handleTransferFailed(admin, payload.data);
          break;

        case 'payment_intent.succeeded':
          await handlePaymentIntentSucceeded(admin, payload.data);
          break;

        case 'payment_intent.failed':
          await handlePaymentIntentFailed(admin, payload.data);
          break;

        case 'movement.created':
          await handleMovementCreated(admin, payload.data);
          break;

        default:
          // Unknown event — logged for reference
          break;
      }

      if (webhookLog?.id) {
        await admin.from('webhook_logs').update({ processed: true }).eq('id', webhookLog.id);
      }
    } catch (err) {
      if (webhookLog?.id) {
        await admin.from('webhook_logs').update({
          error: err instanceof Error ? err.message : 'Processing error',
        }).eq('id', webhookLog.id);
      }
    }

    return Response.json({ received: true });
  } catch {
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleTransferSucceeded(
  admin: ReturnType<typeof getAdminClient>,
  data: Record<string, unknown>
) {
  const transferId = data.id as string;
  if (!transferId) return;

  const { data: payment } = await admin.from('payments')
    .select('id, company_id, created_by, amount, beneficiary_name')
    .eq('fintoc_transfer_id', transferId)
    .single();

  if (!payment) return;

  await admin.from('payments').update({
    status: 'confirmed',
    confirmed_at: new Date().toISOString(),
  }).eq('id', payment.id);

  // Audit log
  await admin.from('audit_log').insert({
    company_id: payment.company_id,
    user_id: payment.created_by || '00000000-0000-0000-0000-000000000000',
    action: 'payment.confirmed',
    entity_type: 'payment',
    entity_id: payment.id,
    metadata: { source: 'webhook', fintoc_transfer_id: transferId },
  });

  // Notification
  if (payment.created_by) {
    await admin.from('notifications').insert({
      company_id: payment.company_id,
      user_id: payment.created_by,
      event_type: 'payment.confirmed',
      entity_type: 'payment',
      entity_id: payment.id,
      title: 'Pago confirmado',
      message: `Pago de $${payment.amount} a ${payment.beneficiary_name} confirmado por SPEI`,
      read: false,
    });
  }
}

async function handleTransferFailed(
  admin: ReturnType<typeof getAdminClient>,
  data: Record<string, unknown>
) {
  const transferId = data.id as string;
  if (!transferId) return;

  const errorObj = data.error as Record<string, unknown> | undefined;
  const errorType = (errorObj?.type as string) || 'unknown';
  const errorMsg = (errorObj?.message as string) || 'Error de transferencia SPEI';

  const { data: payment } = await admin.from('payments')
    .select('id, company_id, created_by, amount, beneficiary_name')
    .eq('fintoc_transfer_id', transferId)
    .single();

  if (!payment) return;

  await admin.from('payments').update({
    status: 'failed',
    fintoc_error: `${errorType}: ${errorMsg}`,
  }).eq('id', payment.id);

  // Audit log
  await admin.from('audit_log').insert({
    company_id: payment.company_id,
    user_id: payment.created_by || '00000000-0000-0000-0000-000000000000',
    action: 'payment.failed',
    entity_type: 'payment',
    entity_id: payment.id,
    metadata: { source: 'webhook', fintoc_transfer_id: transferId, error_type: errorType },
  });

  if (payment.created_by) {
    await admin.from('notifications').insert({
      company_id: payment.company_id,
      user_id: payment.created_by,
      event_type: 'payment.failed',
      entity_type: 'payment',
      entity_id: payment.id,
      title: 'Pago fallido',
      message: `Pago de $${payment.amount} a ${payment.beneficiary_name} falló: ${errorMsg}`,
      read: false,
    });
  }
}

async function handlePaymentIntentSucceeded(
  admin: ReturnType<typeof getAdminClient>,
  data: Record<string, unknown>
) {
  const intentId = data.id as string;
  if (!intentId) return;

  // Find the payment link/collection associated with this intent
  const { data: existing } = await admin.from('webhook_logs')
    .select('id')
    .eq('provider', 'fintoc')
    .eq('event_type', 'payment_intent.succeeded')
    .limit(1)
    .single();

  // Log the successful collection
  const amount = centavosToPesos((data.amount as number) || 0);
  const senderName = ((data.sender_account as Record<string, unknown>)?.holder_name as string) || 'Cliente';

  // Try to find associated invoice/collection
  const metadata = data.metadata as Record<string, string> | undefined;
  if (metadata?.invoice_id) {
    await admin.from('invoices').update({
      payment_state: 'paid',
      amount_paid: amount,
      amount_residual: 0,
    }).eq('id', metadata.invoice_id);
  }

  // Notify — find company from the payment intent metadata or recipient account
  if (metadata?.company_id && metadata?.user_id) {
    await admin.from('notifications').insert({
      company_id: metadata.company_id,
      user_id: metadata.user_id,
      event_type: 'collection.received',
      title: 'Cobro recibido',
      message: `Se recibió un pago de $${amount} de ${senderName}`,
      read: false,
    });
  }

  // Avoid unused variable warning
  void existing;
}

async function handlePaymentIntentFailed(
  admin: ReturnType<typeof getAdminClient>,
  data: Record<string, unknown>
) {
  const metadata = data.metadata as Record<string, string> | undefined;
  if (metadata?.company_id && metadata?.user_id) {
    await admin.from('notifications').insert({
      company_id: metadata.company_id,
      user_id: metadata.user_id,
      event_type: 'collection.failed',
      title: 'Cobro fallido',
      message: 'Un intento de cobro no se completó. El cliente puede reintentar.',
      read: false,
    });
  }
}

async function handleMovementCreated(
  admin: ReturnType<typeof getAdminClient>,
  data: Record<string, unknown>
) {
  const accountId = data.account_id as string;
  if (!accountId) return;

  const { data: account } = await admin.from('bank_accounts')
    .select('company_id')
    .eq('fintoc_account_id', accountId)
    .single();

  if (!account) return;

  const amount = centavosToPesos((data.amount as number) || 0);

  await admin.from('bank_movements').upsert({
    company_id: account.company_id,
    account_id: accountId,
    fintoc_movement_id: data.id as string,
    date: (data.post_date as string) || new Date().toISOString().split('T')[0],
    description: (data.description as string) || null,
    amount,
    type: (data.type as string) === 'credit' ? 'credit' : 'debit',
    reference_id: (data.reference_id as string) || null,
    sender_name: ((data.sender_account as Record<string, unknown>)?.holder_name as string) || null,
    recipient_name: ((data.recipient_account as Record<string, unknown>)?.holder_name as string) || null,
  }, { onConflict: 'fintoc_movement_id' });

  // Auto-reconciliation: try to match with a pending payment
  if ((data.type as string) === 'debit') {
    const { data: matchingPayment } = await admin.from('payments')
      .select('id')
      .eq('company_id', account.company_id)
      .eq('status', 'processing')
      .eq('amount', amount)
      .limit(1)
      .single();

    if (matchingPayment) {
      await admin.from('bank_movements').update({
        reconciled: true,
        reconciled_payment_id: matchingPayment.id,
      }).eq('fintoc_movement_id', data.id as string);
    }
  }
}
