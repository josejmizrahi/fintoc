import { getAdminClient } from '@/lib/supabase/admin';
import { verifyFintocWebhook } from '@/lib/integrations/fintoc';

export async function POST(req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('fintoc-signature') || '';

    if (!verifyFintocWebhook(rawBody, signature)) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody) as {
      type: string;
      data: Record<string, unknown>;
    };

    const admin = getAdminClient();

    // Log the webhook
    const { data: webhookLog } = await admin.from('webhook_logs').insert({
      provider: 'fintoc',
      event_type: payload.type,
      payload,
      processed: false,
    }).select().single();

    try {
      switch (payload.type) {
        case 'transfer.outbound.succeeded': {
          const transferId = payload.data.id as string;
          const { data: payment } = await admin.from('payments')
            .select('id, company_id, created_by, amount, beneficiary_name')
            .eq('fintoc_transfer_id', transferId).single();

          if (payment) {
            await admin.from('payments').update({
              status: 'confirmed', confirmed_at: new Date().toISOString(),
            }).eq('id', payment.id);

            if (payment.created_by) {
              await admin.from('notifications').insert({
                company_id: payment.company_id, user_id: payment.created_by,
                event_type: 'payment.confirmed', entity_type: 'payment', entity_id: payment.id,
                title: 'Pago confirmado',
                message: `Pago de $${payment.amount} a ${payment.beneficiary_name} confirmado`,
                read: false,
              });
            }

            await admin.from('audit_log').insert({
              company_id: payment.company_id,
              user_id: payment.created_by || '00000000-0000-0000-0000-000000000000',
              action: 'payment.confirmed', entity_type: 'payment', entity_id: payment.id,
              metadata: { source: 'webhook', fintoc_transfer_id: transferId },
            });
          }
          break;
        }

        case 'transfer.outbound.failed': {
          const transferId = payload.data.id as string;
          const errorMsg = (payload.data.error as Record<string, unknown>)?.message as string || 'Error de transferencia';

          const { data: payment } = await admin.from('payments')
            .select('id, company_id, created_by, amount')
            .eq('fintoc_transfer_id', transferId).single();

          if (payment) {
            await admin.from('payments').update({ status: 'failed', fintoc_error: errorMsg }).eq('id', payment.id);
            if (payment.created_by) {
              await admin.from('notifications').insert({
                company_id: payment.company_id, user_id: payment.created_by,
                event_type: 'payment.failed', entity_type: 'payment', entity_id: payment.id,
                title: 'Pago fallido', message: `Pago de $${payment.amount} fallo: ${errorMsg}`, read: false,
              });
            }
          }
          break;
        }

        case 'payment_intent.succeeded': {
          // Payment link used by customer
          break;
        }

        case 'movement.created': {
          const movement = payload.data;
          if (movement.account_id) {
            const { data: account } = await admin.from('bank_accounts')
              .select('company_id').eq('fintoc_account_id', movement.account_id as string).single();

            if (account) {
              await admin.from('bank_movements').upsert({
                company_id: account.company_id,
                fintoc_movement_id: movement.id as string,
                date: (movement.post_date as string) || new Date().toISOString().split('T')[0],
                description: movement.description as string || null,
                amount: (movement.amount as number) / 100,
                type: (movement.type as string) === 'credit' ? 'credit' : 'debit',
              }, { onConflict: 'fintoc_movement_id' });
            }
          }
          break;
        }
      }

      if (webhookLog) {
        await admin.from('webhook_logs').update({ processed: true }).eq('id', webhookLog.id);
      }
    } catch (err) {
      if (webhookLog) {
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
