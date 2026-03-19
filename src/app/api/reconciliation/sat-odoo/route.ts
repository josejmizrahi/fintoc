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

interface NormalizedRecord {
  uuid: string;
  rfc_emisor: string;
  rfc_receptor: string;
  fecha: string;
  monto: number;
  monto_sat?: number;
  monto_odoo?: number;
  odoo_ref?: string;
  partner?: string;
  match_type?: string;
  moneda?: string;
  sat_status?: string;
}

function normalizeSat(inv: syntage.SyntageInvoice): NormalizedRecord {
  return {
    uuid: (inv.uuid || '').toLowerCase(),
    rfc_emisor: (inv.issuer?.rfc || '').toUpperCase(),
    rfc_receptor: (inv.receiver?.rfc || '').toUpperCase(),
    fecha: (inv.issued_at || '').split('T')[0],
    monto: Number(inv.total || 0),
    moneda: inv.currency || 'MXN',
    sat_status: inv.status,
  };
}

function normalizeOdoo(inv: Record<string, unknown>): NormalizedRecord {
  return {
    uuid: ((inv.l10n_mx_edi_cfdi_uuid as string) || '').toLowerCase(),
    rfc_emisor: '',
    rfc_receptor: '',
    fecha: ((inv.invoice_date as string) || '').split('T')[0],
    monto: Number(inv.amount_total || 0),
    odoo_ref: (inv.name as string) || undefined,
    partner: odoo.extractM2oName(inv.partner_id as [number, string] | false) || undefined,
  };
}

function mergeRecords(
  sat: NormalizedRecord,
  odooRec: NormalizedRecord,
  matchType: string,
): NormalizedRecord {
  return {
    uuid: sat.uuid || odooRec.uuid,
    rfc_emisor: sat.rfc_emisor,
    rfc_receptor: sat.rfc_receptor,
    fecha: sat.fecha || odooRec.fecha,
    monto: sat.monto,
    odoo_ref: odooRec.odoo_ref,
    partner: odooRec.partner,
    match_type: matchType,
    moneda: sat.moneda,
    sat_status: sat.sat_status,
  };
}

function mergeWithDiff(
  sat: NormalizedRecord,
  odooRec: NormalizedRecord,
  matchType: string,
): NormalizedRecord {
  return {
    ...mergeRecords(sat, odooRec, matchType),
    monto_sat: sat.monto,
    monto_odoo: odooRec.monto,
  };
}

function getOdooVat(inv: Record<string, unknown>): string {
  const ref = (inv.ref as string) || '';
  return ref.toUpperCase();
}

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
        throw new ApiError('INTEGRATION_ERROR', 'Error al descifrar configuracion de Odoo', 500);
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
        ['name', 'l10n_mx_edi_cfdi_uuid', 'amount_total', 'amount_tax', 'amount_untaxed', 'currency_id', 'partner_id', 'invoice_date', 'move_type', 'ref']
      ) as Record<string, unknown>[];
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError('ODOO_ERROR', 'Error al obtener facturas de Odoo', 502);
    }

    // Build UUID maps with normalized records
    const satMap = new Map<string, { raw: syntage.SyntageInvoice; norm: NormalizedRecord }>();
    for (const inv of satInvoices) {
      const norm = normalizeSat(inv);
      if (norm.uuid) satMap.set(norm.uuid, { raw: inv, norm });
    }

    const odooMap = new Map<string, { raw: Record<string, unknown>; norm: NormalizedRecord }>();
    for (const inv of odooInvoices) {
      const norm = normalizeOdoo(inv);
      if (norm.uuid) odooMap.set(norm.uuid, { raw: inv, norm });
    }

    // Results
    const matched: NormalizedRecord[] = [];
    const amountDiff: NormalizedRecord[] = [];
    const matchedSatUuids = new Set<string>();
    const matchedOdooUuids = new Set<string>();
    const usedOdooIds = new Set<number>();

    // PRIMARY: UUID match (case-insensitive)
    for (const [uuid, satEntry] of satMap) {
      const odooEntry = odooMap.get(uuid);
      if (odooEntry) {
        matchedSatUuids.add(uuid);
        matchedOdooUuids.add(uuid);
        usedOdooIds.add(odooEntry.raw.id as number);
        if (Math.abs(satEntry.norm.monto - odooEntry.norm.monto) < 0.01) {
          matched.push(mergeRecords(satEntry.norm, odooEntry.norm, 'uuid'));
        } else {
          amountDiff.push(mergeWithDiff(satEntry.norm, odooEntry.norm, 'amount_diff'));
        }
      }
    }

    // Collect all unmatched Odoo invoices (with and without UUID)
    const allUnmatchedOdoo: { raw: Record<string, unknown>; norm: NormalizedRecord }[] = [];
    for (const [uuid, entry] of odooMap) {
      if (!matchedOdooUuids.has(uuid)) {
        allUnmatchedOdoo.push(entry);
      }
    }
    for (const inv of odooInvoices) {
      if (!inv.l10n_mx_edi_cfdi_uuid) {
        allUnmatchedOdoo.push({ raw: inv, norm: normalizeOdoo(inv) });
      }
    }

    // FALLBACK 1: RFC + date + amount
    const unmatchedSatEntries = [...satMap.entries()].filter(([uuid]) => !matchedSatUuids.has(uuid));

    for (const [satUuid, satEntry] of unmatchedSatEntries) {
      const satRfc = satEntry.norm.rfc_emisor;
      const satDate = satEntry.norm.fecha;
      const satAmount = satEntry.norm.monto;

      let found = false;
      for (const odooEntry of allUnmatchedOdoo) {
        const odooId = odooEntry.raw.id as number;
        if (usedOdooIds.has(odooId)) continue;

        const odooVat = getOdooVat(odooEntry.raw);
        const odooDate = odooEntry.norm.fecha;
        const odooAmount = odooEntry.norm.monto;

        if (
          satRfc && odooVat && satRfc === odooVat &&
          satDate && odooDate && satDate === odooDate &&
          Math.abs(satAmount - odooAmount) < 0.01
        ) {
          matched.push(mergeRecords(satEntry.norm, odooEntry.norm, 'rfc_date_amount'));
          matchedSatUuids.add(satUuid);
          const odooUuid = odooEntry.norm.uuid;
          if (odooUuid) matchedOdooUuids.add(odooUuid);
          usedOdooIds.add(odooId);
          found = true;
          break;
        }
      }

      // FALLBACK 2: date + amount only (no RFC)
      if (!found) {
        for (const odooEntry of allUnmatchedOdoo) {
          const odooId = odooEntry.raw.id as number;
          if (usedOdooIds.has(odooId)) continue;

          const odooDate = odooEntry.norm.fecha;
          const odooAmount = odooEntry.norm.monto;

          if (
            satDate && odooDate && satDate === odooDate &&
            Math.abs(satAmount - odooAmount) < 0.01
          ) {
            matched.push(mergeRecords(satEntry.norm, odooEntry.norm, 'date_amount'));
            matchedSatUuids.add(satUuid);
            const odooUuid = odooEntry.norm.uuid;
            if (odooUuid) matchedOdooUuids.add(odooUuid);
            usedOdooIds.add(odooId);
            break;
          }
        }
      }
    }

    // Build only-SAT list (normalized)
    const onlySat: NormalizedRecord[] = satInvoices
      .filter((inv) => {
        const uuid = (inv.uuid || '').toLowerCase();
        return uuid ? !matchedSatUuids.has(uuid) : true;
      })
      .map(normalizeSat);

    // Build only-Odoo list (normalized)
    const onlyOdoo: NormalizedRecord[] = odooInvoices
      .filter((inv) => {
        const uuid = ((inv.l10n_mx_edi_cfdi_uuid as string) || '').toLowerCase();
        const odooId = inv.id as number;
        if (uuid && matchedOdooUuids.has(uuid)) return false;
        if (usedOdooIds.has(odooId)) return false;
        return true;
      })
      .map(normalizeOdoo);

    const summary = {
      matched: matched.length,
      only_sat: onlySat.length,
      only_odoo: onlyOdoo.length,
      amount_diff: amountDiff.length,
      total_sat: satInvoices.length,
      total_odoo: odooInvoices.length,
    };

    const lastRun = new Date().toISOString();

    // Persist results to reconciliations table
    await admin.from('reconciliations').insert({
      company_id: ctx.company_id,
      type: 'sat_odoo',
      period_start,
      period_end,
      matched_count: matched.length,
      unmatched_count: onlySat.length + onlyOdoo.length,
      discrepancy_count: amountDiff.length,
      result_summary: summary,
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
        summary,
        matched,
        in_sat_not_odoo: onlySat,
        in_odoo_not_sat: onlyOdoo,
        amount_differences: amountDiff,
        last_run: lastRun,
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
