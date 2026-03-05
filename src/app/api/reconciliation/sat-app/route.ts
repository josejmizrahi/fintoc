import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { reconciliationPeriodSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import * as syntage from '@/lib/integrations/syntage';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('reconciliation.execute', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = reconciliationPeriodSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const { period_start, period_end } = result.data;
    const admin = getAdminClient();

    const { data: integration } = await admin
      .from('integrations')
      .select('syntage_taxpayer_id')
      .eq('company_id', ctx.company_id)
      .eq('provider', 'syntage')
      .single();

    if (!integration?.syntage_taxpayer_id) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado', 422);
    }

    // Fetch SAT invoices
    const satResult = (await syntage.getInvoices(integration.syntage_taxpayer_id, {
      dateFrom: period_start,
      dateTo: period_end,
    })) as { data?: Record<string, unknown>[] };
    const satInvoices = satResult?.data || [];

    // Fetch app invoices
    const { data: appInvoices } = await admin
      .from('invoices')
      .select('*')
      .eq('company_id', ctx.company_id)
      .gte('invoice_date', period_start)
      .lte('invoice_date', period_end);

    const satMap = new Map<string, Record<string, unknown>>();
    for (const inv of satInvoices) {
      const uuid = (inv.uuid as string || '').toLowerCase();
      if (uuid) satMap.set(uuid, inv);
    }

    const appMap = new Map<string, Record<string, unknown>>();
    for (const inv of (appInvoices || [])) {
      const uuid = (inv.uuid || '').toLowerCase();
      if (uuid) appMap.set(uuid, inv);
    }

    const matched: Record<string, unknown>[] = [];
    const onlySat: Record<string, unknown>[] = [];
    const onlyApp: Record<string, unknown>[] = [];

    for (const [uuid, satInv] of satMap) {
      if (appMap.has(uuid)) {
        matched.push({ uuid, sat: satInv, app: appMap.get(uuid) });
      } else {
        onlySat.push(satInv);
      }
    }

    for (const [uuid, appInv] of appMap) {
      if (!satMap.has(uuid)) onlyApp.push(appInv);
    }

    return Response.json({
      data: {
        summary: { matched: matched.length, only_sat: onlySat.length, only_app: onlyApp.length },
        details: { matched, only_sat: onlySat, only_app: onlyApp },
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
