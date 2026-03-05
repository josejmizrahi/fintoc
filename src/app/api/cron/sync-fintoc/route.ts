import { getAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/utils/crypto';
import * as fintoc from '@/lib/integrations/fintoc';

export async function GET(req: Request): Promise<Response> {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();
  const results: Array<{ company_id: string; status: string; records_synced?: number; error?: string }> = [];

  try {
    const { data: integrations } = await admin.from('integrations')
      .select('company_id, config_encrypted')
      .eq('provider', 'fintoc')
      .eq('status', 'valid');

    for (const integration of (integrations || [])) {
      try {
        let secretKey = process.env.FINTOC_SECRET_KEY;
        if (integration.config_encrypted) {
          try {
            secretKey = (decrypt(integration.config_encrypted) as Record<string, string>).secret_key;
          } catch { /* use env */ }
        }
        if (!secretKey) continue;

        let recordsSynced = 0;

        const { data: syncEntry } = await admin.from('sync_history').insert({
          company_id: integration.company_id, provider: 'fintoc', status: 'running',
        }).select().single();

        const accounts = (await fintoc.getAccounts(secretKey)) as Array<{
          id: string; number?: string; name?: string; holder_name?: string;
          balance?: { available?: number }; currency?: string;
        }>;

        for (const account of (accounts || [])) {
          await admin.from('bank_accounts').upsert({
            company_id: integration.company_id,
            fintoc_account_id: account.id,
            clabe: account.number || '',
            bank_name: account.name || null,
            account_holder: account.holder_name || null,
            balance: account.balance?.available ? account.balance.available / 100 : null,
            currency: account.currency || 'MXN',
            last_synced: new Date().toISOString(),
          }, { onConflict: 'fintoc_account_id' });

          const since = new Date();
          since.setDate(since.getDate() - 7);
          const movements = (await fintoc.getMovements(account.id, {
            since: since.toISOString().split('T')[0], per_page: 100,
          }, secretKey)) as Array<{
            id: string; amount: number; post_date?: string; description?: string; type?: string;
          }>;

          for (const mov of (movements || [])) {
            await admin.from('bank_movements').upsert({
              company_id: integration.company_id,
              account_id: account.id,
              fintoc_movement_id: mov.id,
              date: mov.post_date || new Date().toISOString().split('T')[0],
              description: mov.description || null,
              amount: mov.amount / 100,
              type: mov.type === 'credit' ? 'credit' : 'debit',
            }, { onConflict: 'fintoc_movement_id' });
            recordsSynced++;
          }
        }

        await admin.from('sync_history').update({
          status: 'completed', records_synced: recordsSynced, completed_at: new Date().toISOString(),
        }).eq('id', syncEntry?.id);

        await admin.from('integrations').update({ last_sync: new Date().toISOString() })
          .eq('company_id', integration.company_id).eq('provider', 'fintoc');

        results.push({ company_id: integration.company_id, status: 'completed', records_synced: recordsSynced });
      } catch (err) {
        results.push({
          company_id: integration.company_id, status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return Response.json({ data: { processed: results.length, results } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
