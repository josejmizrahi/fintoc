import crypto from 'crypto';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import { getOdooConfigForCompany } from '@/lib/integrations/config';
import * as odoo from '@/lib/integrations/odoo';

const odooWebhookSchema = z.object({
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

const moveTypeToAppType: Record<string, 'payable' | 'receivable'> = {
  in_invoice: 'payable',
  in_refund: 'payable',
  out_invoice: 'receivable',
  out_refund: 'receivable',
};

export async function POST(req: Request): Promise<Response> {
  try {
    // Verify token with timing-safe comparison
    const authHeader = req.headers.get('authorization');
    const expectedToken = process.env.ODOO_WEBHOOK_TOKEN;

    if (!expectedToken) {
      return Response.json({ error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'Webhook token not configured' } }, { status: 500 });
    }

    const receivedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const expected = Buffer.from(expectedToken, 'utf8');
    const received = Buffer.from(receivedToken, 'utf8');

    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      return Response.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook token' } }, { status: 401 });
    }

    const parsed = odooWebhookSchema.safeParse(await req.json());
    const admin = getAdminClient();

    if (!parsed.success) {
      await admin.from('webhook_logs').insert({
        provider: 'odoo',
        event_type: 'unknown',
        payload: null,
        processed: false,
        error: `Validation failed: ${parsed.error.message}`,
      });
      return Response.json({ received: true });
    }

    const payload = parsed.data;

    // Idempotency: skip if we already logged this exact event
    const eventId = (payload.data?.id as string) || null;
    if (eventId) {
      const { data: existing } = await admin.from('webhook_logs')
        .select('id, payload')
        .eq('provider', 'odoo')
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
      provider: 'odoo',
      event_type: payload.type,
      payload,
      processed: false,
    }).select('id').single();

    try {
      const companyId = (payload.data?.company_id as string) || null;

      switch (payload.type) {
        case 'invoice.created':
        case 'invoice.updated':
        case 'invoice.posted':
          if (companyId) {
            await handleInvoiceEvent(admin, companyId, payload.data);
          }
          break;

        case 'payment.posted':
        case 'payment.reconciled':
          if (companyId) {
            await handlePaymentEvent(admin, companyId, payload.data);
          }
          break;

        case 'partner.updated':
          if (companyId) {
            await handlePartnerEvent(admin, companyId, payload.data);
          }
          break;

        default:
          // Unknown event type — just log it
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
    return Response.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal error' } }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleInvoiceEvent(
  admin: ReturnType<typeof getAdminClient>,
  companyId: string,
  data: Record<string, unknown>,
) {
  const odooMoveId = data.id as number | undefined;
  if (!odooMoveId) return;

  // Fetch the full invoice from Odoo to get current data
  let config: odoo.OdooConfig;
  try {
    config = await getOdooConfigForCompany(companyId);
  } catch {
    return; // Can't connect to Odoo — skip
  }

  try {
    const invoices = await odoo.odooSearchRead(
      config,
      'account.move',
      [['id', '=', odooMoveId]],
      [
        'name', 'move_type', 'partner_id', 'invoice_date', 'invoice_date_due',
        'amount_total', 'amount_residual', 'amount_tax', 'state', 'payment_state',
        'l10n_mx_edi_cfdi_uuid', 'l10n_mx_edi_payment_policy', 'l10n_mx_edi_usage',
      ],
      1,
    );

    if (!invoices.length) return;
    const inv = invoices[0] as odoo.OdooInvoice;
    if (inv.state !== 'posted') return;
    if (inv.move_type === 'entry') return;

    const appType = moveTypeToAppType[inv.move_type] ?? 'payable';
    const uuid = odoo.normalizeOdooValue(inv.l10n_mx_edi_cfdi_uuid);

    const invoiceData: Record<string, unknown> = {
      company_id: companyId,
      type: appType,
      move_type: inv.move_type,
      invoice_number: inv.name,
      uuid,
      invoice_date: odoo.normalizeOdooValue(inv.invoice_date),
      due_date: odoo.normalizeOdooValue(inv.invoice_date_due),
      amount_total: inv.amount_total,
      amount_residual: inv.amount_residual,
      amount_paid: inv.amount_total - inv.amount_residual,
      amount_tax: inv.amount_tax,
      payment_state: inv.payment_state,
      payment_method: odoo.normalizeOdooValue(inv.l10n_mx_edi_payment_policy),
      partner_name: odoo.extractM2oName(inv.partner_id),
      odoo_id: inv.id,
      odoo_move_id: String(inv.id),
      source: 'odoo',
    };

    // Upsert by company_id + odoo_id
    await admin.from('invoices')
      .upsert(invoiceData, { onConflict: 'company_id,odoo_id', ignoreDuplicates: false });
  } catch {
    // Log but don't throw — webhook should still succeed
  }
}

async function handlePaymentEvent(
  admin: ReturnType<typeof getAdminClient>,
  companyId: string,
  data: Record<string, unknown>,
) {
  // When a payment is posted/reconciled in Odoo, update the related invoice's payment_state
  const invoiceMoveId = data.invoice_id as number | undefined;
  if (!invoiceMoveId) return;

  let config: odoo.OdooConfig;
  try {
    config = await getOdooConfigForCompany(companyId);
  } catch {
    return;
  }

  try {
    const invoices = await odoo.odooSearchRead(
      config,
      'account.move',
      [['id', '=', invoiceMoveId]],
      ['amount_residual', 'payment_state'],
      1,
    );

    if (!invoices.length) return;
    const inv = invoices[0] as { amount_residual: number; payment_state: string };

    await admin.from('invoices')
      .update({
        amount_residual: inv.amount_residual,
        amount_paid: (data.amount as number) || 0,
        payment_state: inv.payment_state,
      })
      .eq('company_id', companyId)
      .eq('odoo_move_id', String(invoiceMoveId));
  } catch {
    // Best effort
  }
}

async function handlePartnerEvent(
  admin: ReturnType<typeof getAdminClient>,
  companyId: string,
  data: Record<string, unknown>,
) {
  const partnerId = data.id as number | undefined;
  if (!partnerId) return;

  let config: odoo.OdooConfig;
  try {
    config = await getOdooConfigForCompany(companyId);
  } catch {
    return;
  }

  try {
    const partner = await odoo.fetchOdooPartnerById(config, partnerId);
    if (!partner) return;

    const rfc = odoo.normalizeOdooValue(partner.vat)?.toUpperCase();
    if (!rfc) return;

    const partnerData = {
      name: partner.name,
      email: odoo.normalizeOdooValue(partner.email),
      phone: odoo.normalizeOdooValue(partner.phone),
      odoo_id: String(partner.id),
    };

    // Update vendor or customer depending on rank
    if (partner.supplier_rank && partner.supplier_rank > 0) {
      await admin.from('vendors')
        .update({ ...partnerData, synced_at: new Date().toISOString() })
        .eq('company_id', companyId)
        .eq('rfc', rfc);
    }
    if (partner.customer_rank && partner.customer_rank > 0) {
      await admin.from('customers')
        .update({ ...partnerData, updated_at: new Date().toISOString() })
        .eq('company_id', companyId)
        .eq('rfc', rfc);
    }
  } catch {
    // Best effort
  }
}
