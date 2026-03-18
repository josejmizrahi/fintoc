import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import { verifySyntageWebhook, parseEfosStatus, mapSatStatus, mapInvoiceType } from '@/lib/integrations/syntage';
import type { ExtractionStatus, ExtractionErrorCode } from '@/lib/integrations/syntage';

const syntageWebhookSchema = z.object({
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

type SyntageWebhookPayload = z.infer<typeof syntageWebhookSchema>;

export async function POST(req: Request): Promise<Response> {
  try {
    const webhookSecret = req.headers.get('x-webhook-secret') || '';
    const expectedSecret = process.env.SYNTAGE_WEBHOOK_SECRET;

    if (!expectedSecret || !verifySyntageWebhook(expectedSecret, webhookSecret)) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const parsed = syntageWebhookSchema.safeParse(await req.json());
    const admin = getAdminClient();

    if (!parsed.success) {
      await admin.from('webhook_logs').insert({
        provider: 'syntage',
        event_type: 'unknown',
        payload: null,
        processed: false,
        error: `Validation failed: ${parsed.error.message}`,
      });
      return Response.json({ received: true });
    }

    const payload: SyntageWebhookPayload = parsed.data;

    // Idempotency: check if we already processed this exact event
    const eventId = (payload.data?.id as string) || null;
    if (eventId) {
      const { data: existing } = await admin.from('webhook_logs')
        .select('id, payload')
        .eq('provider', 'syntage')
        .eq('event_type', payload.type)
        .eq('processed', true)
        .limit(10);

      const isDuplicate = (existing || []).some((log: { payload?: { data?: Record<string, unknown> } }) => {
        return (log.payload?.data?.id as string) === eventId;
      });

      if (isDuplicate) {
        return Response.json({ received: true, deduplicated: true });
      }
    }

    // Log the webhook
    const { data: webhookLog } = await admin.from('webhook_logs').insert({
      provider: 'syntage',
      event_type: payload.type,
      payload,
      processed: false,
    }).select('id').single();

    try {
      switch (payload.type) {
        case 'credential.updated':
          await handleCredentialUpdated(admin, payload.data);
          break;

        case 'extraction.created':
        case 'extraction.updated':
          await handleExtractionUpdated(admin, payload.data);
          break;

        case 'invoice.created':
        case 'invoice.updated':
          await handleInvoiceEvent(admin, payload.data);
          break;

        case 'tax_status.updated':
          await handleTaxStatusUpdated(admin, payload.data);
          break;

        case 'tax_compliance_check.created':
          await handleTaxComplianceCreated(admin, payload.data);
          break;

        case 'tax_retention.created':
        case 'tax_retention.updated':
          // Logged in webhook_logs for reference
          break;

        default:
          break;
      }

      if (webhookLog?.id) {
        await admin.from('webhook_logs').update({ processed: true, error: null }).eq('id', webhookLog.id);
      }
    } catch (err) {
      if (webhookLog?.id) {
        await admin.from('webhook_logs').update({
          error: err instanceof Error ? err.message : 'Processing error',
        }).eq('id', webhookLog.id);
      }
    }

    return Response.json({ received: true });
  } catch {
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleCredentialUpdated(
  admin: ReturnType<typeof getAdminClient>,
  data: Record<string, unknown>,
) {
  const credentialId = data.id as string;
  const status = data.status as string;

  const { data: integration } = await admin.from('integrations')
    .select('id, company_id').eq('syntage_credential_id', credentialId).single();

  if (!integration) return;

  await admin.from('integrations').update({
    status: status === 'valid' ? 'valid' : 'invalid',
    syntage_taxpayer_id: (data.taxpayer_id as string) || null,
  }).eq('id', integration.id);

  const title = status === 'valid' ? 'FIEL validada exitosamente' : 'Error al validar FIEL';
  const message = status === 'valid'
    ? 'Tu FIEL fue validada con el SAT. Las extracciones de datos están habilitadas.'
    : `Error al validar FIEL: ${(data.error as string) || 'Verifica tus credenciales'}`;

  await notifyAdmins(admin, integration.company_id, 'sat.credential_valid', title, message);
}

async function handleExtractionUpdated(
  admin: ReturnType<typeof getAdminClient>,
  data: Record<string, unknown>,
) {
  const extractionId = data.id as string;
  const status = data.status as ExtractionStatus;
  const errorCode = data.errorCode as ExtractionErrorCode | undefined;

  const updateData: Record<string, unknown> = {
    status,
    records_found: (data.recordsFound as number) || null,
  };

  if (errorCode) {
    updateData.error_code = errorCode;
    updateData.error_message = (data.error as string) || errorCode;
  }

  if (['finished', 'failed', 'stopped', 'cancelled'].includes(status)) {
    updateData.completed_at = new Date().toISOString();
  }

  await admin.from('syntage_extractions').update(updateData)
    .eq('syntage_extraction_id', extractionId);

  if (status === 'failed') {
    const { data: extraction } = await admin.from('syntage_extractions')
      .select('company_id, extractor')
      .eq('syntage_extraction_id', extractionId)
      .single();

    if (extraction) {
      await notifyAdmins(
        admin,
        extraction.company_id,
        'sat.extraction_failed',
        'Extracción SAT fallida',
        `La extracción de ${extraction.extractor} falló: ${errorCode || 'Error desconocido'}`,
      );
    }
  }
}

async function handleInvoiceEvent(
  admin: ReturnType<typeof getAdminClient>,
  data: Record<string, unknown>,
) {
  const uuid = ((data.uuid as string) || '').toLowerCase();
  if (!uuid) return;

  const taxpayerId = (data.taxpayer_id as string) || (data.taxpayerId as string);
  if (!taxpayerId) return;

  const { data: integration } = await admin.from('integrations')
    .select('company_id')
    .eq('syntage_taxpayer_id', taxpayerId)
    .eq('provider', 'sat')
    .single();

  if (!integration) return;

  const companyId = integration.company_id;
  const satStatus = mapSatStatus((data.status as string) || 'Vigente');
  const invoiceType = mapInvoiceType((data.type as string) || '');
  const issuer = data.issuer as Record<string, unknown> | undefined;
  const receiver = data.receiver as Record<string, unknown> | undefined;
  const efos = parseEfosStatus(data.efos_validation as string | undefined);

  // SAT enrichment fields — always update regardless of source
  const satFields: Record<string, unknown> = {
    sat_status: satStatus,
    sat_validated: true,
    sat_last_check: new Date().toISOString(),
    syntage_invoice_id: data.id as string,
    validated_at: new Date().toISOString(),
    // CFDI 4.0 fields from Syntage
    tipo_comprobante: (data.voucher_effect as string) || (data.type as string) || null,
    metodo_pago: (data.payment_method as string) || null,
    forma_pago: (data.payment_form as string) || null,
    uso_cfdi: (data.cfdi_usage as string) || null,
    moneda: (data.currency as string) || 'MXN',
    tipo_cambio: (data.exchange_rate as number) || null,
    descuento: (data.discount as number) || 0,
    lugar_expedicion: (data.place_of_issue as string) || null,
    emisor_nombre: (issuer?.name as string) || null,
    receptor_nombre: (receiver?.name as string) || null,
    emisor_regimen: (issuer?.tax_regime as string) || null,
    receptor_regimen: (receiver?.tax_regime as string) || null,
    issuer_rfc: (issuer?.rfc as string) || null,
    issuer_name: (issuer?.name as string) || null,
    receiver_rfc: (receiver?.rfc as string) || null,
    receiver_name: (receiver?.name as string) || null,
    es_cancelable: (data.is_cancellable as string) || null,
    estatus_cancelacion: (data.cancellation_status as string) || null,
  };

  if (efos.status !== null) {
    satFields.efos_status = efos.isBlocked ? 'definitivo' : efos.isRisky ? 'presunto' : null;
  }

  // Check if invoice already exists (from manual or Odoo source)
  const { data: existing } = await admin.from('invoices')
    .select('id, source')
    .eq('company_id', companyId)
    .eq('uuid', uuid)
    .single();

  if (existing) {
    // Invoice exists — only ENRICH with SAT data, preserve source and amounts
    const { error: updateError } = await admin.from('invoices')
      .update(satFields)
      .eq('id', existing.id);

    if (updateError) {
      throw new Error(`Failed to update invoice with SAT data: ${updateError.message}`);
    }
  } else {
    // Invoice is new from SAT — create full record
    const invoiceRow = {
      company_id: companyId,
      uuid,
      source: 'sat',
      type: invoiceType,
      amount_total: (data.total as number) || 0,
      amount_tax: (data.tax as number) || 0,
      amount_paid: 0,
      amount_residual: (data.total as number) || 0,
      invoice_date: (data.issued_at as string)?.split('T')[0] || new Date().toISOString().split('T')[0],
      payment_method: (data.payment_method as string) || null,
      currency: (data.currency as string) || 'MXN',
      ...satFields,
    };

    const { error: insertError } = await admin.from('invoices')
      .insert(invoiceRow);

    if (insertError) {
      throw new Error(`Failed to insert SAT invoice: ${insertError.message}`);
    }
  }

  // Handle EFOS detection: update vendor with timestamp tracking
  if (efos.isBlocked || efos.isRisky) {
    const issuerRfc = ((issuer?.rfc as string) || '').toUpperCase();
    if (issuerRfc) {
      const efosStatus = efos.isBlocked ? 'definitivo' : 'presunto';

      // Update vendor EFOS status with timestamp
      const { error: vendorError } = await admin.from('vendors')
        .update({
          efos_status: efosStatus,
          efos_checked_at: new Date().toISOString(),
        })
        .eq('company_id', companyId)
        .eq('rfc', issuerRfc);

      if (vendorError) {
        console.error(`[syntage-webhook] Failed to update vendor EFOS for ${issuerRfc}:`, vendorError.message);
      }

      const severity = efos.isBlocked ? 'ALERTA CRÍTICA' : 'Advertencia';
      await notifyAdmins(
        admin,
        companyId,
        'vendor.efos_detected',
        `${severity}: Proveedor en lista EFOS`,
        `RFC ${issuerRfc} detectado como ${efos.label}. ${efos.isBlocked ? 'Los pagos a este proveedor están bloqueados.' : 'Se recomienda revisar la relación comercial.'}`,
      );
    }
  }
}

async function handleTaxStatusUpdated(
  admin: ReturnType<typeof getAdminClient>,
  data: Record<string, unknown>,
) {
  const taxpayerId = (data.taxpayer_id as string) || (data.taxpayerId as string);
  if (!taxpayerId) return;

  const { data: integration } = await admin.from('integrations')
    .select('company_id')
    .eq('syntage_taxpayer_id', taxpayerId)
    .eq('provider', 'sat')
    .single();

  if (!integration) return;

  await notifyAdmins(
    admin,
    integration.company_id,
    'sat.tax_status_updated',
    'Constancia de situación fiscal actualizada',
    'Se detectó un cambio en la constancia de situación fiscal ante el SAT.',
  );
}

async function handleTaxComplianceCreated(
  admin: ReturnType<typeof getAdminClient>,
  data: Record<string, unknown>,
) {
  const taxpayerId = (data.taxpayer_id as string) || (data.taxpayerId as string);
  if (!taxpayerId) return;

  const { data: integration } = await admin.from('integrations')
    .select('company_id')
    .eq('syntage_taxpayer_id', taxpayerId)
    .eq('provider', 'sat')
    .single();

  if (!integration) return;

  const opinion = (data.result as string) || 'desconocido';
  const isPositive = opinion.toLowerCase().includes('positiv');

  await notifyAdmins(
    admin,
    integration.company_id,
    'sat.tax_compliance',
    'Opinión de cumplimiento SAT',
    `Resultado de opinión de cumplimiento: ${opinion}${!isPositive ? '. Se recomienda atención inmediata.' : '.'}`,
  );
}

// ---------------------------------------------------------------------------
// Notification helper
// ---------------------------------------------------------------------------

async function notifyAdmins(
  admin: ReturnType<typeof getAdminClient>,
  companyId: string,
  eventType: string,
  title: string,
  message: string,
) {
  const { data: admins } = await admin.from('user_companies')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('role', 'admin');

  if (!admins?.length) return;

  const notifications = admins.map((a: { user_id: string }) => ({
    company_id: companyId,
    user_id: a.user_id,
    event_type: eventType,
    title,
    message,
    read: false,
  }));

  await admin.from('notifications').insert(notifications);
}
