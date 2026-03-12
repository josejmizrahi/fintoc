import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';
import { getFintocConfigForCompany } from '@/lib/integrations/sync-engine';
import { getMovements, centavosToPesos } from '@/lib/integrations/fintoc';
import { parsePaginationParams } from '@/lib/utils/response';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('treasury.read', async (_req, ctx) => {
    const url = new URL(_req.url);
    const { page, limit } = parsePaginationParams(url);
    const offset = (page - 1) * limit;
    const admin = getAdminClient();
    const companyId = String(ctx.company_id);

    const dateFrom = url.searchParams.get('date_from') ?? new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const dateTo = url.searchParams.get('date_to') ?? new Date().toISOString().slice(0, 10);
    const typeFilter = url.searchParams.get('type');

    const { secretKey, linkToken } = await getFintocConfigForCompany(companyId);

    const { data: bankAccounts } = await admin
      .from('bank_accounts')
      .select('id, fintoc_account_id')
      .eq('company_id', companyId)
      .not('fintoc_account_id', 'is', null);

    if (!bankAccounts?.length) {
      return Response.json({ data: [], meta: { total: 0, page, limit } });
    }

    const accountIdToInternalId = new Map<string, string>();
    for (const row of bankAccounts) {
      if (row.fintoc_account_id) accountIdToInternalId.set(row.fintoc_account_id, row.id);
    }

    const allRows: Array<{
      id: string;
      company_id: string;
      account_id: string;
      fintoc_movement_id: string;
      date: string;
      description: string | null;
      amount: number;
      type: 'credit' | 'debit';
      reference_id: string | null;
      sender_account: string | null;
      counterpart_name: string | null;
      reconciled: boolean;
    }> = [];

    for (const acc of bankAccounts) {
      const fintocAccountId = acc.fintoc_account_id;
      if (!fintocAccountId) continue;
      const movements = await getMovements(
        fintocAccountId,
        { since: dateFrom, until: dateTo, per_page: 300, link_token: linkToken },
        secretKey,
      );
      const internalAccountId = accountIdToInternalId.get(fintocAccountId) ?? acc.id;
      for (const mov of movements ?? []) {
        if (typeFilter && mov.type !== typeFilter) continue;
        allRows.push({
          id: mov.id,
          company_id: companyId,
          account_id: internalAccountId,
          fintoc_movement_id: mov.id,
          date: mov.post_date ?? new Date().toISOString().slice(0, 10),
          description: mov.description ?? null,
          amount: centavosToPesos(mov.amount),
          type: mov.type === 'credit' ? 'credit' : 'debit',
          reference_id: mov.reference_id ?? null,
          sender_account: mov.sender_account?.holder_name ?? null,
          counterpart_name: mov.recipient_account?.holder_name ?? null,
          reconciled: false,
        });
      }
    }

    allRows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const total = allRows.length;
    const data = allRows.slice(offset, offset + limit);

    return Response.json({ data, meta: { total, page, limit } });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
