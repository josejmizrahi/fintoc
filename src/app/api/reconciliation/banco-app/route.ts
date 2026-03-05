import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { reconciliationPeriodSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('reconciliation.execute', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = reconciliationPeriodSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const { period_start, period_end } = result.data;
    const admin = getAdminClient();

    // Get bank movements
    const { data: movements } = await admin
      .from('bank_movements')
      .select('*')
      .eq('company_id', ctx.company_id)
      .gte('date', period_start)
      .lte('date', period_end);

    // Get confirmed payments
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

    for (const mov of (movements || [])) {
      let found = false;
      for (const pay of (payments || [])) {
        if (matchedPaymentIds.has(pay.id)) continue;

        const amountMatch = Math.abs(Math.abs(mov.amount) - pay.amount) < 0.01;
        const dateMatch = mov.date && pay.confirmed_at &&
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

    for (const pay of (payments || [])) {
      if (!matchedPaymentIds.has(pay.id)) onlyApp.push(pay);
    }

    return Response.json({
      data: {
        summary: { matched: matched.length, only_bank: onlyBank.length, only_app: onlyApp.length },
        details: { matched, only_bank: onlyBank, only_app: onlyApp },
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
