import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { reconciliationPeriodSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { getFintocConfigForCompany } from '@/lib/integrations/config';
import { getMovements, centavosToPesos } from '@/lib/integrations/fintoc';
import { writeAuditLog } from '@/lib/middleware/audit';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('reconciliation.execute', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = reconciliationPeriodSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const { period_start, period_end } = result.data;
    const admin = getAdminClient();
    const companyId = String(ctx.company_id);

    const { secretKey, linkToken } = await getFintocConfigForCompany(companyId);

    const { data: bankAccounts } = await admin
      .from('bank_accounts')
      .select('id, fintoc_account_id')
      .eq('company_id', companyId)
      .not('fintoc_account_id', 'is', null);

    const movements: Array<{
      id: string;
      account_id: string;
      date: string;
      amount: number;
      type: string;
      description: string | null;
      reference_id: string | null;
      sender_account: string | null;
      counterpart_name: string | null;
    }> = [];

    if (bankAccounts?.length) {
      for (const acc of bankAccounts) {
        const fintocAccountId = acc.fintoc_account_id;
        if (!fintocAccountId) continue;
        const list = await getMovements(
          fintocAccountId,
          { since: period_start, until: period_end, per_page: 300, link_token: linkToken },
          secretKey,
        );
        for (const mov of list ?? []) {
          movements.push({
            id: mov.id,
            account_id: acc.id,
            date: mov.post_date ?? new Date().toISOString().slice(0, 10),
            amount: centavosToPesos(mov.amount),
            type: mov.type === 'credit' ? 'credit' : 'debit',
            description: mov.description ?? null,
            reference_id: mov.reference_id ?? null,
            sender_account: mov.sender_account?.holder_name ?? null,
            counterpart_name: mov.recipient_account?.holder_name ?? null,
          });
        }
      }
    }

    const { data: payments } = await admin
      .from('payments')
      .select('*')
      .eq('company_id', ctx.company_id)
      .eq('status', 'confirmed')
      .gte('confirmed_at', period_start)
      .lte('confirmed_at', period_end);

    const matched: Record<string, unknown>[] = [];
    const onlyBank: Record<string, unknown>[] = [];
    const onlyApp: Record<string, unknown>[] = [];
    const matchedPaymentIds = new Set<string>();

    for (const mov of movements) {
      let found = false;
      for (const pay of (payments || [])) {
        if (matchedPaymentIds.has(pay.id)) continue;

        const amountMatch = Math.abs(Math.abs(mov.amount) - pay.amount) < 0.01;
        const dateMatch =
          mov.date &&
          pay.confirmed_at &&
          Math.abs(new Date(mov.date).getTime() - new Date(pay.confirmed_at).getTime()) < 86400000 * 2;

        if (amountMatch && dateMatch) {
          matched.push({ movement: mov, payment: pay });
          matchedPaymentIds.add(pay.id);
          found = true;
          break;
        }
      }
      if (!found) onlyBank.push(mov);
    }

    for (const pay of payments || []) {
      if (!matchedPaymentIds.has(pay.id)) onlyApp.push(pay);
    }

    writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'reconciliation.banco_app_executed',
      entity_type: 'reconciliation',
      entity_id: ctx.company_id,
      metadata: { period_start, period_end, matched: matched.length, only_bank: onlyBank.length, only_app: onlyApp.length },
    });

    return Response.json({
      data: {
        summary: { matched: matched.length, only_bank: onlyBank.length, only_app: onlyApp.length },
        details: { matched, only_bank: onlyBank, only_app: onlyApp },
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
