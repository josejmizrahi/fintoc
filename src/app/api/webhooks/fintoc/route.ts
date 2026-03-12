import crypto from 'crypto';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import { verifyFintocWebhook, centavosToPesos } from '@/lib/integrations/fintoc';

const fintocWebhookSchema = z.object({
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

type FintocWebhookPayload = z.infer<typeof fintocWebhookSchema>;

export async function POST(req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('fintoc-signature') || '';
    const isRetry = req.headers.get('x-webhook-retry') === 'true';
    const retryLogId = req.headers.get('x-webhook-log-id') || null;

    // Signature validation: retries from our own cron include x-webhook-log-id
    // which we verify exists in the DB (prevents forged retry headers)
    if (!isRetry && !verifyFintocWebhook(rawBody, signature)) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const parsed = fintocWebhookSchema.safeParse(JSON.parse(rawBody));
    const admin = getAdminClient();

    if (!parsed.success) {
      await admin.from('webhook_logs').insert({
        provider: 'fintoc',
        event_type: 'unknown',
        payload: rawBody,
        processed: false,
        error: `Validation failed: ${parsed.error.message}`,
      });
      return Response.json({ received: true });
    }

    const payload = parsed.data;

    // For retries, verify both the log ID AND the retry HMAC signature
    if (isRetry && retryLogId) {
      const retrySignature = req.headers.get('x-webhook-retry-signature') || '';
      const retrySecret = process.env.WEBHOOK_RETRY_SECRET || process.env.FINTOC_SECRET_KEY || '';

      // Verify HMAC signature of the retry request
      const expectedPayload = `${retryLogId}:fintoc`;
      const expectedSig = crypto.createHmac('sha256', retrySecret).update(expectedPayload).digest('hex');

      const sigBuffer = Buffer.from(retrySignature, 'hex');
      const expectedBuffer = Buffer.from(expectedSig, 'hex');

      if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
        return Response.json({ error: 'Invalid retry signature' }, { status: 401 });
      }

      // Also verify the log entry exists in DB
      const { data: logEntry } = await admin.from('webhook_logs')
        .select('id')
        .eq('id', retryLogId)
        .eq('provider', 'fintoc')
        .single();

      if (!logEntry) {
        return Response.json({ error: 'Invalid retry reference' }, { status: 401 });
      }
    }

    // Idempotency: check if we already processed this exact event
    // Use transfer/intent ID + event type as the dedup key
    const eventDedup = extractEventKey(payload);
    if (eventDedup) {
      const { data: existing } = await admin.from('webhook_logs')
        .select('id')
        .eq('provider', 'fintoc')
        .eq('event_type', payload.type)
        .eq('processed', true)
        .limit(1);

      // Check if any processed log has the same dedup key in payload
      if (existing && existing.length > 0 && !isRetry) {
        // For non-retry, do a deeper check with the actual entity ID
        const { data: dupCheck } = await admin.from('webhook_logs')
          .select('id, payload')
          .eq('provider', 'fintoc')
          .eq('event_type', payload.type)
          .eq('processed', true)
          .limit(10);

        const isDuplicate = (dupCheck || []).some((log: { payload?: { data?: Record<string, unknown> } }) => {
          const logKey = extractEventKey({ type: payload.type, data: log.payload?.data || {} });
          return logKey === eventDedup;
        });

        if (isDuplicate) {
          return Response.json({ received: true, deduplicated: true });
        }
      }
    }

    // Log the webhook (skip for retries that already have a log entry)
    let webhookLogId = retryLogId;
    if (!retryLogId) {
      const { data: webhookLog } = await admin.from('webhook_logs').insert({
        provider: 'fintoc',
        event_type: payload.type,
        payload,
        processed: false,
      }).select('id').single();
      webhookLogId = webhookLog?.id || null;
    }

    try {
      switch (payload.type) {
        case 'transfer.outbound.succeeded':
          await handleTransferSucceeded(admin, payload.data);
          break;

        case 'transfer.outbound.failed':
        case 'transfer.outbound.rejected':
        case 'transfer.outbound.returned':
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
          break;
      }

      if (webhookLogId) {
        await admin.from('webhook_logs').update({ processed: true, error: null }).eq('id', webhookLogId);
      }
    } catch (err) {
      if (webhookLogId) {
        await admin.from('webhook_logs').update({
          error: err instanceof Error ? err.message : 'Processing error',
        }).eq('id', webhookLogId);
      }
    }

    return Response.json({ received: true });
  } catch {
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

/** Extract a dedup key from the event payload */
function extractEventKey(payload: FintocWebhookPayload): string | null {
  const id = payload.data?.id as string;
  if (!id) return null;
  return `${payload.type}:${id}`;
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleTransferSucceeded(
  admin: ReturnType<typeof getAdminClient>,
  data: Record<string, unknown>,
) {
  const transferId = data.id as string;
  if (!transferId) return;

  const { data: payment } = await admin.from('payments')
    .select('id, company_id, created_by, amount, beneficiary_name, status')
    .eq('fintoc_transfer_id', transferId)
    .single();

  if (!payment) return;

  // Idempotent: skip if already confirmed
  if (payment.status === 'confirmed') return;

  await admin.from('payments').update({
    status: 'confirmed',
    confirmed_at: new Date().toISOString(),
  }).eq('id', payment.id);

  await admin.from('audit_log').insert({
    company_id: payment.company_id,
    user_id: payment.created_by || '00000000-0000-0000-0000-000000000000',
    action: 'payment.confirmed',
    entity_type: 'payment',
    entity_id: payment.id,
    metadata: { source: 'webhook', fintoc_transfer_id: transferId },
  });

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
  data: Record<string, unknown>,
) {
  const transferId = data.id as string;
  if (!transferId) return;

  const errorObj = data.error as Record<string, unknown> | undefined;
  const errorType = (errorObj?.type as string) || 'unknown';
  const errorMsg = (errorObj?.message as string) || 'Error de transferencia SPEI';

  const { data: payment } = await admin.from('payments')
    .select('id, company_id, created_by, amount, beneficiary_name, status')
    .eq('fintoc_transfer_id', transferId)
    .single();

  if (!payment) return;

  // Idempotent: skip if already in a terminal state
  if (payment.status === 'failed' || payment.status === 'confirmed') return;

  await admin.from('payments').update({
    status: 'failed',
    fintoc_error: `${errorType}: ${errorMsg}`,
  }).eq('id', payment.id);

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
  data: Record<string, unknown>,
) {
  const intentId = data.id as string;
  if (!intentId) return;

  const amount = centavosToPesos((data.amount as number) || 0);
  const senderName = ((data.sender_account as Record<string, unknown>)?.holder_name as string) || 'Cliente';

  const metadata = data.metadata as Record<string, string> | undefined;
  if (metadata?.invoice_id) {
    // Fetch current invoice to ensure we don't overwrite a more recent state
    const { data: invoice } = await admin.from('invoices')
      .select('id, payment_state')
      .eq('id', metadata.invoice_id)
      .single();

    if (invoice && invoice.payment_state !== 'paid') {
      await admin.from('invoices').update({
        payment_state: 'paid',
        amount_paid: amount,
        amount_residual: 0,
      }).eq('id', metadata.invoice_id);
    }
  }

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
}

async function handlePaymentIntentFailed(
  admin: ReturnType<typeof getAdminClient>,
  data: Record<string, unknown>,
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
  _admin: ReturnType<typeof getAdminClient>,
  _data: Record<string, unknown>,
) {
  // Movements are no longer stored; treasury and reconciliation fetch from Fintoc API on demand.
  // No-op: optional auto-reconciliation could update payment.bank_movement_ref when we add that column.
}
