import { getAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/utils/crypto';
import * as fintoc from '@/lib/integrations/fintoc';

export async function GET(req: Request): Promise<Response> {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();
  const now = new Date().toISOString();

  try {
    // Find payments scheduled for now or past that are still in approved status
    const { data: scheduled } = await admin.from('payments')
      .select('id, company_id, amount, beneficiary_clabe, beneficiary_name, concept, created_by, fintoc_transfer_id')
      .eq('status', 'approved')
      .not('scheduled_date', 'is', null)
      .lte('scheduled_date', now);

    let processed = 0;
    let failed = 0;

    for (const payment of (scheduled || [])) {
      // Skip if already has a transfer (idempotent)
      if (payment.fintoc_transfer_id) continue;

      try {
        // Get Fintoc credentials for this company
        const { data: integration } = await admin.from('integrations')
          .select('config_encrypted').eq('company_id', payment.company_id).eq('provider', 'fintoc').single();

        let secretKey = process.env.FINTOC_SECRET_KEY;
        if (integration?.config_encrypted) {
          try { secretKey = (decrypt(integration.config_encrypted) as Record<string, string>).secret_key; } catch { /* use env */ }
        }
        if (!secretKey) {
          failed++;
          continue;
        }

        const transfer = (await fintoc.createTransfer({
          amount: Math.round(payment.amount * 100),
          currency: 'MXN',
          destination_account: { number: payment.beneficiary_clabe },
          concept: payment.concept || `Pago ${payment.id}`,
        }, secretKey)) as { id: string };

        await admin.from('payments').update({
          status: 'processing', fintoc_transfer_id: transfer.id,
        }).eq('id', payment.id);

        await admin.from('audit_log').insert({
          company_id: payment.company_id,
          user_id: payment.created_by || '00000000-0000-0000-0000-000000000000',
          action: 'payment.executed', entity_type: 'payment', entity_id: payment.id,
          metadata: { source: 'cron_scheduled', fintoc_transfer_id: transfer.id },
        });

        processed++;
      } catch (err) {
        await admin.from('payments').update({
          status: 'failed', fintoc_error: err instanceof Error ? err.message : 'Scheduled execution error',
        }).eq('id', payment.id);
        failed++;
      }
    }

    return Response.json({ data: { found: (scheduled || []).length, processed, failed } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
