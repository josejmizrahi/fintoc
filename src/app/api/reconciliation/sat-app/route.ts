import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { reconciliationPeriodSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import * as syntage from '@/lib/integrations/syntage';
import { writeAuditLog } from '@/lib/middleware/audit';

interface NormalizedRecord {
  uuid: string;
  rfc_emisor: string;
  rfc_receptor: string;
  fecha: string;
  monto: number;
  monto_sat?: number;
  monto_app?: number;
  invoice_ref?: string;
  partner?: string;
  match_type?: string;
  sat_status?: string;
}

function transformSatInvoice(inv: syntage.SyntageInvoice): NormalizedRecord {
  return {
    uuid: (inv.uuid as string || '').toLowerCase(),
    rfc_emisor: (inv.issuer?.rfc || '').toUpperCase(),
    rfc_receptor: (inv.receiver?.rfc || '').toUpperCase(),
    fecha: (inv.issued_at || '').split('T')[0],
    monto: Number(inv.total || 0),
    sat_status: inv.status as string | undefined,
  };
}

function transformAppInvoice(inv: Record<string, unknown>): NormalizedRecord {
  return {
    uuid: ((inv.uuid as string) || '').toLowerCase(),
    rfc_emisor: '',
    rfc_receptor: '',
    fecha: inv.invoice_date as string || '',
    monto: Number(inv.amount_total || 0),
    invoice_ref: (inv.invoice_number || inv.name) as string | undefined,
    partner: (inv.partner_name || inv.emisor_nombre) as string | undefined,
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

    const { data: integration } = await admin
      .from('integrations')
      .select('syntage_taxpayer_id')
      .eq('company_id', ctx.company_id)
      .eq('provider', 'sat')
      .single();

    if (!integration?.syntage_taxpayer_id) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado', 422);
    }

    // Fetch SAT invoices
    let satInvoices: syntage.SyntageInvoice[] = [];
    try {
      satInvoices = await syntage.getInvoices(integration.syntage_taxpayer_id, {
        date_from: period_start,
        date_to: period_end,
      });
    } catch {
      throw new ApiError('SYNTAGE_ERROR', 'Error al obtener facturas de SAT', 502);
    }

    // Fetch app invoices
    const { data: appInvoices } = await admin
      .from('invoices')
      .select('*')
      .eq('company_id', ctx.company_id)
      .gte('invoice_date', period_start)
      .lte('invoice_date', period_end);

    // Transform to normalized records
    const satNormalized = satInvoices.map(transformSatInvoice);
    const appNormalized = (appInvoices || []).map(transformAppInvoice);

    // Build UUID maps
    const satByUuid = new Map<string, NormalizedRecord>();
    for (const rec of satNormalized) {
      if (rec.uuid) satByUuid.set(rec.uuid, rec);
    }

    const appByUuid = new Map<string, NormalizedRecord>();
    const appWithoutUuid: NormalizedRecord[] = [];
    for (const rec of appNormalized) {
      if (rec.uuid) {
        appByUuid.set(rec.uuid, rec);
      } else {
        appWithoutUuid.push(rec);
      }
    }

    const matched: NormalizedRecord[] = [];
    const amountDifferences: NormalizedRecord[] = [];
    const matchedSatUuids = new Set<string>();
    const matchedAppUuids = new Set<string>();

    // PRIMARY: UUID match (case-insensitive)
    for (const [uuid, satRec] of satByUuid) {
      const appRec = appByUuid.get(uuid);
      if (appRec) {
        matchedSatUuids.add(uuid);
        matchedAppUuids.add(uuid);

        if (Math.abs(satRec.monto - appRec.monto) < 0.01) {
          matched.push({
            ...satRec,
            monto_sat: satRec.monto,
            monto_app: appRec.monto,
            invoice_ref: appRec.invoice_ref,
            partner: appRec.partner,
            match_type: 'uuid',
          });
        } else {
          amountDifferences.push({
            ...satRec,
            monto_sat: satRec.monto,
            monto_app: appRec.monto,
            invoice_ref: appRec.invoice_ref,
            partner: appRec.partner,
            match_type: 'amount_diff',
          });
        }
      }
    }

    // FALLBACK: For unmatched SAT invoices, try date + amount matching against app invoices without UUID
    const unmatchedAppNoUuid = [...appWithoutUuid];
    const usedAppNoUuidIndices = new Set<number>();

    // Also collect unmatched app invoices that have UUIDs but weren't matched
    const unmatchedAppWithUuid = [...appByUuid.entries()]
      .filter(([uuid]) => !matchedAppUuids.has(uuid))
      .map(([_uuid, rec]) => rec);

    const fallbackCandidates = [...unmatchedAppNoUuid, ...unmatchedAppWithUuid];
    const usedFallbackIndices = new Set<number>();

    for (const [uuid, satRec] of satByUuid) {
      if (matchedSatUuids.has(uuid)) continue;

      for (let i = 0; i < fallbackCandidates.length; i++) {
        if (usedFallbackIndices.has(i)) continue;
        const appRec = fallbackCandidates[i];

        const dateMatch = satRec.fecha && appRec.fecha && satRec.fecha === appRec.fecha;
        const amountMatch = Math.abs(satRec.monto - appRec.monto) < 0.01;

        if (dateMatch && amountMatch) {
          matched.push({
            ...satRec,
            monto_sat: satRec.monto,
            monto_app: appRec.monto,
            invoice_ref: appRec.invoice_ref,
            partner: appRec.partner,
            match_type: 'date_amount',
          });
          matchedSatUuids.add(uuid);
          if (appRec.uuid) matchedAppUuids.add(appRec.uuid);
          usedFallbackIndices.add(i);
          // Track index for appWithoutUuid subset
          if (i < unmatchedAppNoUuid.length) usedAppNoUuidIndices.add(i);
          break;
        }
      }
    }

    // Build only_sat and only_app lists
    const inSatOnly: NormalizedRecord[] = satNormalized.filter((rec) => {
      return rec.uuid ? !matchedSatUuids.has(rec.uuid) : true;
    });

    const inAppOnly: NormalizedRecord[] = appNormalized.filter((rec) => {
      if (rec.uuid && matchedAppUuids.has(rec.uuid)) return false;
      if (!rec.uuid) {
        // Check if this app record was used in fallback matching
        const idx = unmatchedAppNoUuid.indexOf(rec);
        if (idx !== -1 && usedAppNoUuidIndices.has(idx)) return false;
      }
      return true;
    });

    const lastRun = new Date().toISOString();

    // Persist to reconciliations table
    await admin.from('reconciliations').insert({
      company_id: ctx.company_id,
      type: 'sat_app',
      period_start,
      period_end,
      summary: {
        matched: matched.length,
        only_sat: inSatOnly.length,
        only_app: inAppOnly.length,
        amount_diff: amountDifferences.length,
      },
      results: {
        matched,
        in_sat_only: inSatOnly,
        in_app_only: inAppOnly,
        amount_differences: amountDifferences,
      },
      created_by: ctx.user_id,
      created_at: lastRun,
    });

    writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'reconciliation.sat_app_executed',
      entity_type: 'reconciliation',
      entity_id: ctx.company_id,
      metadata: {
        period_start,
        period_end,
        matched: matched.length,
        only_sat: inSatOnly.length,
        only_app: inAppOnly.length,
        amount_diff: amountDifferences.length,
      },
    });

    return Response.json({
      data: {
        summary: {
          matched: matched.length,
          only_sat: inSatOnly.length,
          only_app: inAppOnly.length,
          amount_diff: amountDifferences.length,
        },
        matched,
        in_sat_only: inSatOnly,
        in_app_only: inAppOnly,
        amount_differences: amountDifferences,
        last_run: lastRun,
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
