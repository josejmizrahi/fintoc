import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import { verifySyntageWebhook, parseEfosCode, mapSatStatus, mapInvoiceType } from '@/lib/integrations/syntage';
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
  const satStatus = mapSatStatus((data.status as string) || 'active');
  const invoiceType = mapInvoiceType((data.type as string) || '');
  const efos = parseEfosCode(data.efosValidation as number | undefined);

  const invoiceFields: Record<string, unknown> = {
    sat_status: satStatus,
    syntage_invoice_id: data.id as string,
    validated_at: new Date().toISOString(),
  };

  if (efos.code !== null) {
    invoiceFields.efos_status = efos.isBlocked ? 'definitivo' : efos.isRisky ? 'presunto' : null;
  }

  // Use upsert-style: try update first, then insert if not found.
  // This avoids the race condition of check-then-insert.
  const { data: existing } = await admin.from('invoices')
    .select('id')
    .eq('uuid', uuid)
    .eq('company_id', companyId)
    .limit(1)
    .single();

  if (existing) {
    await admin.from('invoices').update(invoiceFields).eq('id', existing.id);
  } else {
    // Insert new invoice — use a unique constraint-safe approach
    const newInvoice = {
      company_id: companyId,
      uuid,
      source: 'sat',
      type: invoiceType,
      amount_total: (data.total as number) || 0,
      amount_tax: (data.tax as number) || 0,
      amount_paid: 0,
      amount_residual: (data.total as number) || 0,
      invoice_date: (data.issuedAt as string)?.split('T')[0] || new Date().toISOString().split('T')[0],
      issuer_rfc: (data.issuerRfc as string) || (data.issuer_rfc as string) || null,
      issuer_name: (data.issuerName as string) || null,
      receiver_rfc: (data.receiverRfc as string) || (data.receiver_rfc as string) || null,
      receiver_name: (data.receiverName as string) || null,
      payment_method: (data.paymentMethod as string) || null,
      currency: (data.currency as string) || 'MXN',
      ...invoiceFields,
    };

    const { error: insertError } = await admin.from('invoices').insert(newInvoice);

    // If insert fails due to duplicate (concurrent webhook), fall back to update
    if (insertError?.code === '23505') {
      const { data: retryExisting } = await admin.from('invoices')
        .select('id')
        .eq('uuid', uuid)
        .eq('company_id', companyId)
        .limit(1)
        .single();

      if (retryExisting) {
        await admin.from('invoices').update(invoiceFields).eq('id', retryExisting.id);
      }
    } else if (insertError) {
      throw new Error(`Failed to insert invoice: ${insertError.message}`);
    }
  }

  // Handle EFOS detection: update vendor and invoice atomically
  if (efos.isBlocked || efos.isRisky) {
    const issuerRfc = ((data.issuerRfc as string) || (data.issuer_rfc as string) || '').toUpperCase();
    if (issuerRfc) {
      const efosStatus = efos.isBlocked ? 'definitivo' : 'presunto';

      // Update vendor EFOS status
      const { error: vendorError } = await admin.from('vendors')
        .update({ efos_status: efosStatus })
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
