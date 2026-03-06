import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { reconciliationPeriodSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import * as syntage from '@/lib/integrations/syntage';
import * as odoo from '@/lib/integrations/odoo';
import { decrypt } from '@/lib/utils/crypto';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('reconciliation.execute', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = reconciliationPeriodSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const { period_start, period_end } = result.data;
    const admin = getAdminClient();

    // Get Syntage integration (stored under provider='sat' in integrations table)
    const { data: syntageInt } = await admin
      .from('integrations')
      .select('syntage_taxpayer_id')
      .eq('company_id', ctx.company_id)
      .eq('provider', 'sat')
      .single();

    if (!syntageInt?.syntage_taxpayer_id) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado', 422);
    }

    // Get Odoo integration
    const { data: odooInt } = await admin
      .from('integrations')
      .select('config_encrypted')
      .eq('company_id', ctx.company_id)
      .eq('provider', 'odoo')
      .single();

    if (!odooInt?.config_encrypted) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Odoo no configurado', 422);
    }

    // Fetch SAT invoices
    let satInvoices: syntage.SyntageInvoice[] = [];
    try {
      satInvoices = await syntage.getInvoices(syntageInt.syntage_taxpayer_id, {
        dateFrom: period_start,
        dateTo: period_end,
      });
    } catch {
      throw new ApiError('SYNTAGE_ERROR', 'Error al obtener facturas de SAT', 502);
    }

    // Fetch Odoo invoices
    let odooInvoices: Record<string, unknown>[] = [];
    try {
      const config = decrypt(odooInt.config_encrypted) as unknown as odoo.OdooConfig;
      odooInvoices = await odoo.odooSearchRead(
        config,
        'account.move',
        [
          ['move_type', 'in', ['in_invoice', 'out_invoice']],
          ['invoice_date', '>=', period_start],
          ['invoice_date', '<=', period_end],
          ['state', '=', 'posted'],
        ],
        ['name', 'l10n_mx_edi_cfdi_uuid', 'amount_total', 'partner_id', 'invoice_date']
      ) as Record<string, unknown>[];
    } catch {
      throw new ApiError('ODOO_ERROR', 'Error al obtener facturas de Odoo', 502);
    }

    // Build UUID maps
    const satMap = new Map<string, Record<string, unknown>>();
    for (const inv of satInvoices) {
      const uuid = (inv.uuid as string || '').toLowerCase();
      if (uuid) satMap.set(uuid, inv);
    }

    const odooMap = new Map<string, Record<string, unknown>>();
    for (const inv of odooInvoices) {
      const uuid = (inv.l10n_mx_edi_cfdi_uuid as string || '').toLowerCase();
      if (uuid) odooMap.set(uuid, inv);
    }

    // Cross-reference
    const matched: Record<string, unknown>[] = [];
    const onlySat: Record<string, unknown>[] = [];
    const onlyOdoo: Record<string, unknown>[] = [];
    const amountDiff: Record<string, unknown>[] = [];

    for (const [uuid, satInv] of satMap) {
      const odooInv = odooMap.get(uuid);
      if (odooInv) {
        const satAmount = Number(satInv.total || 0);
        const odooAmount = Number(odooInv.amount_total || 0);
        if (Math.abs(satAmount - odooAmount) < 0.01) {
          matched.push({ uuid, sat: satInv, odoo: odooInv });
        } else {
          amountDiff.push({ uuid, sat: satInv, odoo: odooInv, difference: satAmount - odooAmount });
        }
      } else {
        onlySat.push(satInv);
      }
    }

    for (const [uuid, odooInv] of odooMap) {
      if (!satMap.has(uuid)) {
        onlyOdoo.push(odooInv);
      }
    }

    return Response.json({
      data: {
        summary: {
          matched: matched.length,
          only_sat: onlySat.length,
          only_odoo: onlyOdoo.length,
          amount_diff: amountDiff.length,
        },
        details: { matched, only_sat: onlySat, only_odoo: onlyOdoo, amount_diff: amountDiff },
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
