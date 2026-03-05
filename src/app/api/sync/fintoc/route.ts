import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/utils/crypto';
import * as fintoc from '@/lib/integrations/fintoc';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('sync.execute', async (_req, ctx) => {
    const admin = getAdminClient();

    let secretKey = process.env.FINTOC_SECRET_KEY;
    const { data: integration } = await admin.from('integrations').select('config_encrypted')
      .eq('company_id', ctx.company_id).eq('provider', 'fintoc').single();

    if (integration?.config_encrypted) {
      try { secretKey = (decrypt(integration.config_encrypted) as Record<string, string>).secret_key; } catch { /* use env */ }
    }
    if (!secretKey) throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Fintoc no configurado', 422);

    const { data: syncEntry } = await admin.from('sync_history').insert({
      company_id: ctx.company_id, provider: 'fintoc', status: 'running',
    }).select().single();

    let recordsSynced = 0;
    try {
      // Refresh accounts
      const accounts = (await fintoc.getAccounts(secretKey)) as Array<{ id: string; number?: string; name?: string; holder_name?: string; balance?: { available?: number }; currency?: string }>;

      for (const account of (accounts || [])) {
        await admin.from('bank_accounts').upsert({
          company_id: ctx.company_id,
          fintoc_account_id: account.id,
          clabe: account.number || '',
          bank_name: account.name || null,
          account_holder: account.holder_name || null,
          balance: account.balance?.available ? account.balance.available / 100 : null,
          currency: account.currency || 'MXN',
          last_synced: new Date().toISOString(),
        }, { onConflict: 'fintoc_account_id' });

        // Fetch recent movements
        const since = new Date();
        since.setDate(since.getDate() - 30);
        const movements = (await fintoc.getMovements(account.id, {
          since: since.toISOString().split('T')[0],
          per_page: 100,
        }, secretKey)) as Array<{ id: string; amount: number; post_date?: string; description?: string; type?: string }>;

        for (const mov of (movements || [])) {
          await admin.from('bank_movements').upsert({
            company_id: ctx.company_id,
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
        .eq('company_id', ctx.company_id).eq('provider', 'fintoc');

      return Response.json({ data: { status: 'completed', records_synced: recordsSynced } });
    } catch (err) {
      await admin.from('sync_history').update({
        status: 'failed', error_message: err instanceof Error ? err.message : 'Unknown', completed_at: new Date().toISOString(),
      }).eq('id', syncEntry?.id);
      throw new ApiError('FINTOC_ERROR', 'Error al sincronizar con Fintoc', 502);
    }
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'batch' });
