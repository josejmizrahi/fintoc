import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';
import { getAccount } from '@/lib/integrations/fintoc';
import { decrypt } from '@/lib/utils/crypto';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('treasury.read', async (_req, ctx) => {
    const admin = getAdminClient();

    const { data: accounts } = await admin.from('bank_accounts').select('*').eq('company_id', ctx.company_id);
    if (!accounts || accounts.length === 0) {
      return Response.json({ data: { accounts: [], total_balance: 0 } });
    }

    // Get Fintoc key
    let secretKey = process.env.FINTOC_SECRET_KEY;
    const { data: integration } = await admin.from('integrations').select('config_encrypted')
      .eq('company_id', ctx.company_id).eq('provider', 'fintoc').single();

    if (integration?.config_encrypted) {
      try { secretKey = (decrypt(integration.config_encrypted) as Record<string, string>).secret_key; } catch { /* use env */ }
    }

    // Refresh each account
    for (const account of accounts) {
      try {
        const fresh = (await getAccount(account.fintoc_account_id, secretKey || undefined)) as { balance?: { available?: number } };
        const balance = fresh.balance?.available ? fresh.balance.available / 100 : account.balance;
        await admin.from('bank_accounts').update({ balance, last_synced: new Date().toISOString() }).eq('id', account.id);
        account.balance = balance;
      } catch { /* keep cached balance */ }
    }

    const totalBalance = accounts.reduce((s, a) => s + (a.balance || 0), 0);
    return Response.json({ data: { accounts, total_balance: totalBalance } });
  }))(req, { params: Promise.resolve({}) });
});
