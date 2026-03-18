import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { reconciliationPeriodSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { getFintocConfigForCompany } from '@/lib/integrations/config';
import { getMovements, centavosToPesos } from '@/lib/integrations/fintoc';
import { writeAuditLog } from '@/lib/middleware/audit';

interface NormalizedRecord {
  id: string;
  bank_ref: string;
  app_ref: string;
  fecha: string;
  monto: number;
  monto_banco?: number;
  monto_app?: number;
  descripcion?: string;
  counterpart_name?: string;
  reference_id?: string;
  match_type?: string;
}

interface BankMovement {
  id: string;
  account_id: string;
  date: string;
  amount: number;
  type: string;
  description: string | null;
  reference_id: string | null;
  sender_account: string | null;
  counterpart_name: string | null;
}

interface AppPayment {
  id: string;
  amount: number;
  confirmed_at: string;
  fintoc_payment_id?: string | null;
  reference?: string | null;
  description?: string | null;
  vendor_name?: string | null;
  [key: string]: unknown;
}

function normalizeFromMovement(mov: BankMovement): NormalizedRecord {
  return {
    id: mov.id,
    bank_ref: mov.id,
    app_ref: '',
    fecha: mov.date,
    monto: Math.abs(mov.amount),
    monto_banco: Math.abs(mov.amount),
    descripcion: mov.description || undefined,
    counterpart_name: mov.counterpart_name || mov.sender_account || undefined,
    reference_id: mov.reference_id || undefined,
  };
}

function normalizeFromPayment(pay: AppPayment): NormalizedRecord {
  return {
    id: pay.id,
    bank_ref: '',
    app_ref: pay.id,
    fecha: (pay.confirmed_at || '').split('T')[0],
    monto: Number(pay.amount || 0),
    monto_app: Number(pay.amount || 0),
    descripcion: (pay.description || pay.vendor_name) as string | undefined,
    reference_id: (pay.fintoc_payment_id || pay.reference) as string | undefined,
  };
}

function buildMatchedRecord(mov: BankMovement, pay: AppPayment, matchType: string): NormalizedRecord {
  return {
    id: mov.id,
    bank_ref: mov.id,
    app_ref: pay.id,
    fecha: mov.date,
    monto: Math.abs(mov.amount),
    monto_banco: Math.abs(mov.amount),
    monto_app: Number(pay.amount || 0),
    descripcion: mov.description || undefined,
    counterpart_name: mov.counterpart_name || mov.sender_account || undefined,
    reference_id: mov.reference_id || undefined,
    match_type: matchType,
  };
}

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

    const movements: BankMovement[] = [];

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

    const allPayments = (payments || []) as AppPayment[];

    const matched: NormalizedRecord[] = [];
    const matchedMovementIds = new Set<string>();
    const matchedPaymentIds = new Set<string>();

    // Build reference index for payments: fintoc_payment_id and reference
    const paymentByReference = new Map<string, AppPayment>();
    for (const pay of allPayments) {
      if (pay.fintoc_payment_id) {
        paymentByReference.set(String(pay.fintoc_payment_id), pay);
      }
      if (pay.reference) {
        paymentByReference.set(String(pay.reference), pay);
      }
    }

    // PRIMARY: reference_id match
    for (const mov of movements) {
      if (!mov.reference_id) continue;

      const pay = paymentByReference.get(mov.reference_id);
      if (pay && !matchedPaymentIds.has(pay.id)) {
        matched.push(buildMatchedRecord(mov, pay, 'reference'));
        matchedMovementIds.add(mov.id);
        matchedPaymentIds.add(pay.id);
      }
    }

    // SECONDARY: amount + date match (1-day tolerance, score-based for best date)
    const DATE_TOLERANCE_MS = 86400000; // 1 day

    for (const mov of movements) {
      if (matchedMovementIds.has(mov.id)) continue;

      const movAmount = Math.abs(mov.amount);
      const movDate = new Date(mov.date).getTime();

      let bestCandidate: AppPayment | null = null;
      let bestDateDiff = Infinity;

      for (const pay of allPayments) {
        if (matchedPaymentIds.has(pay.id)) continue;

        const payAmount = Number(pay.amount || 0);
        const amountMatch = Math.abs(movAmount - payAmount) < 0.01;
        if (!amountMatch) continue;

        if (!mov.date || !pay.confirmed_at) continue;
        const payDate = new Date(pay.confirmed_at).getTime();
        const dateDiff = Math.abs(movDate - payDate);

        if (dateDiff <= DATE_TOLERANCE_MS && dateDiff < bestDateDiff) {
          bestCandidate = pay;
          bestDateDiff = dateDiff;
        }
      }

      if (bestCandidate) {
        matched.push(buildMatchedRecord(mov, bestCandidate, 'amount_date'));
        matchedMovementIds.add(mov.id);
        matchedPaymentIds.add(bestCandidate.id);
      }
    }

    // Build unmatched lists
    const inBancoOnly: NormalizedRecord[] = movements
      .filter((mov) => !matchedMovementIds.has(mov.id))
      .map(normalizeFromMovement);

    const inAppOnly: NormalizedRecord[] = allPayments
      .filter((pay) => !matchedPaymentIds.has(pay.id))
      .map(normalizeFromPayment);

    const lastRun = new Date().toISOString();

    // Persist to reconciliations table
    await admin.from('reconciliations').insert({
      company_id: ctx.company_id,
      type: 'banco_app',
      period_start,
      period_end,
      summary: {
        matched: matched.length,
        only_bank: inBancoOnly.length,
        only_app: inAppOnly.length,
      },
      results: {
        matched,
        in_banco_only: inBancoOnly,
        in_app_only: inAppOnly,
      },
      created_by: ctx.user_id,
      created_at: lastRun,
    });

    writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'reconciliation.banco_app_executed',
      entity_type: 'reconciliation',
      entity_id: ctx.company_id,
      metadata: {
        period_start,
        period_end,
        matched: matched.length,
        only_bank: inBancoOnly.length,
        only_app: inAppOnly.length,
      },
    });

    return Response.json({
      data: {
        summary: {
          matched: matched.length,
          only_bank: inBancoOnly.length,
          only_app: inAppOnly.length,
        },
        matched,
        in_banco_only: inBancoOnly,
        in_app_only: inAppOnly,
        last_run: lastRun,
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
