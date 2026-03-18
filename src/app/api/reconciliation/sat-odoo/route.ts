import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { reconciliationPeriodSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import * as syntage from '@/lib/integrations/syntage';
import * as odoo from '@/lib/integrations/odoo';
import { decrypt } from '@/lib/utils/crypto';
import { writeAuditLog } from '@/lib/middleware/audit';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('reconciliation.execute', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = reconciliationPeriodSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const { period_start, period_end } = result.data;
    const admin = getAdminClient();

    // Get Syntage integration
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
        date_from: period_start,
        date_to: period_end,
      });
    } catch {
      throw new ApiError('SYNTAGE_ERROR', 'Error al obtener facturas de SAT', 502);
    }

    // Fetch Odoo invoices — include refunds for complete reconciliation
    let odooInvoices: Record<string, unknown>[] = [];
    try {
      let config: odoo.OdooConfig;
      try {
        config = decrypt(odooInt.config_encrypted) as unknown as odoo.OdooConfig;
      } catch {
        throw new ApiError('INTEGRATION_ERROR', 'Error al descifrar configuración de Odoo', 500);
      }

      odooInvoices = await odoo.odooSearchRead(
        config,
        'account.move',
        [
          ['move_type', 'in', ['in_invoice', 'out_invoice', 'in_refund', 'out_refund']],
          ['invoice_date', '>=', period_start],
          ['invoice_date', '<=', period_end],
          ['state', '=', 'posted'],
        ],
        ['name', 'l10n_mx_edi_cfdi_uuid', 'amount_total', 'partner_id', 'invoice_date', 'move_type']
      ) as Record<string, unknown>[];
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError('ODOO_ERROR', 'Error al obtener facturas de Odoo', 502);
    }

    // Build UUID maps
    const satMap = new Map<string, syntage.SyntageInvoice>();
    for (const inv of satInvoices) {
      const uuid = (inv.uuid || '').toLowerCase();
      if (uuid) satMap.set(uuid, inv);
    }

    const odooMap = new Map<string, Record<string, unknown>>();
    for (const inv of odooInvoices) {
      const uuid = ((inv.l10n_mx_edi_cfdi_uuid as string) || '').toLowerCase();
      if (uuid) odooMap.set(uuid, inv);
    }

    // Cross-reference by UUID (primary match)
    const matched: Record<string, unknown>[] = [];
    const amountDiff: Record<string, unknown>[] = [];
    const matchedSatUuids = new Set<string>();
    const matchedOdooUuids = new Set<string>();

    for (const [uuid, satInv] of satMap) {
      const odooInv = odooMap.get(uuid);
      if (odooInv) {
        matchedSatUuids.add(uuid);
        matchedOdooUuids.add(uuid);
        const satAmount = Number(satInv.total || 0);
        const odooAmount = Number(odooInv.amount_total || 0);
        if (Math.abs(satAmount - odooAmount) < 0.01) {
          matched.push({ uuid, sat: satInv, odoo: odooInv, match_type: 'uuid' });
        } else {
          amountDiff.push({ uuid, sat: satInv, odoo: odooInv, difference: satAmount - odooAmount, match_type: 'uuid' });
        }
      }
    }

    // Fallback: match unmatched invoices by RFC + date + amount
    const unmatchedSat = [...satMap.entries()].filter(([uuid]) => !matchedSatUuids.has(uuid));
    const unmatchedOdoo = [...odooMap.entries()].filter(([uuid]) => !matchedOdooUuids.has(uuid));
    // Also include Odoo invoices without UUID
    const odooNoUuid = odooInvoices.filter((inv) => !inv.l10n_mx_edi_cfdi_uuid);

    const usedOdooIds = new Set<number>();

    for (const [_satUuid, satInv] of unmatchedSat) {
      const _satRfc = satInv.issuer?.rfc?.toUpperCase() || '';
      const satDate = (satInv.issued_at || '').split('T')[0];
      const satAmount = Number(satInv.total || 0);

      // Search in unmatched Odoo invoices (with UUID)
      let found = false;
      for (const [odooUuid, odooInv] of unmatchedOdoo) {
        if (matchedOdooUuids.has(odooUuid)) continue;
        const odooId = odooInv.id as number;
        if (usedOdooIds.has(odooId)) continue;

        const odooPartner = odoo.extractM2oName(odooInv.partner_id as [number, string] | false) || '';
        const odooDate = (odooInv.invoice_date as string || '').split('T')[0];
        const odooAmount = Number(odooInv.amount_total || 0);

        const dateMatch = satDate && odooDate && satDate === odooDate;
        const amountMatch = Math.abs(satAmount - odooAmount) < 0.01;

        if (dateMatch && amountMatch) {
          matched.push({ uuid: _satUuid, sat: satInv, odoo: odooInv, match_type: 'date_amount', partner: odooPartner });
          matchedSatUuids.add(_satUuid);
          matchedOdooUuids.add(odooUuid);
          usedOdooIds.add(odooId);
          found = true;
          break;
        }
      }

      // Also search in Odoo invoices without UUID
      if (!found) {
        for (const odooInv of odooNoUuid) {
          const odooId = odooInv.id as number;
          if (usedOdooIds.has(odooId)) continue;

          const odooDate = (odooInv.invoice_date as string || '').split('T')[0];
          const odooAmount = Number(odooInv.amount_total || 0);

          const dateMatch = satDate && odooDate && satDate === odooDate;
          const amountMatch = Math.abs(satAmount - odooAmount) < 0.01;

          if (dateMatch && amountMatch) {
            matched.push({ uuid: _satUuid, sat: satInv, odoo: odooInv, match_type: 'date_amount_no_uuid' });
            matchedSatUuids.add(_satUuid);
            usedOdooIds.add(odooId);
            break;
          }
        }
      }
    }

    const onlySat = satInvoices.filter((inv) => {
      const uuid = (inv.uuid || '').toLowerCase();
      return uuid ? !matchedSatUuids.has(uuid) : true;
    });

    const onlyOdoo = odooInvoices.filter((inv) => {
      const uuid = ((inv.l10n_mx_edi_cfdi_uuid as string) || '').toLowerCase();
      const odooId = inv.id as number;
      if (uuid && matchedOdooUuids.has(uuid)) return false;
      if (usedOdooIds.has(odooId)) return false;
      return true;
    });

    writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'reconciliation.sat_odoo_executed',
      entity_type: 'reconciliation',
      entity_id: ctx.company_id,
      metadata: {
        period_start, period_end,
        matched: matched.length,
        only_sat: onlySat.length,
        only_odoo: onlyOdoo.length,
        amount_diff: amountDiff.length,
      },
    });

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
