import { getAdminClient } from '@/lib/supabase/admin';

export async function POST(req: Request): Promise<Response> {
  try {
    const webhookSecret = req.headers.get('x-webhook-secret') || '';
    const expectedSecret = process.env.SYNTAGE_WEBHOOK_SECRET;

    if (!expectedSecret || webhookSecret !== expectedSecret) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const payload = await req.json() as {
      type: string;
      data: Record<string, unknown>;
    };

    const admin = getAdminClient();

    const { data: webhookLog } = await admin.from('webhook_logs').insert({
      provider: 'syntage', event_type: payload.type, payload, processed: false,
    }).select().single();

    try {
      switch (payload.type) {
        case 'credential.updated': {
          const credentialId = payload.data.id as string;
          const status = payload.data.status as string;

          const { data: integration } = await admin.from('integrations')
            .select('id, company_id').eq('syntage_credential_id', credentialId).single();

          if (integration) {
            await admin.from('integrations').update({
              status: status === 'valid' ? 'valid' : 'invalid',
              syntage_taxpayer_id: payload.data.taxpayer_id as string || null,
            }).eq('id', integration.id);

            const { data: admins } = await admin.from('user_companies')
              .select('user_id').eq('company_id', integration.company_id).eq('role', 'admin');

            for (const a of (admins || [])) {
              await admin.from('notifications').insert({
                company_id: integration.company_id, user_id: a.user_id,
                event_type: 'sat.credential_valid',
                title: status === 'valid' ? 'FIEL validada exitosamente' : 'Error al validar FIEL',
                message: status === 'valid' ? 'Tu FIEL fue validada con el SAT' : 'Error al validar FIEL',
                read: false,
              });
            }
          }
          break;
        }

        case 'extraction.updated': {
          const extractionId = payload.data.id as string;
          const status = payload.data.status as string;
          await admin.from('syntage_extractions').update({
            status, records_found: (payload.data.records_found as number) || null,
            error_message: (payload.data.error as string) || null,
            completed_at: ['completed', 'failed'].includes(status) ? new Date().toISOString() : null,
          }).eq('syntage_extraction_id', extractionId);
          break;
        }

        case 'invoice.created':
        case 'invoice.updated': {
          const uuid = ((payload.data.uuid as string) || '').toLowerCase();
          if (uuid) {
            const satStatus = (payload.data.status as string) === 'active' ? 'vigente' :
                             (payload.data.status as string) === 'cancelled' ? 'cancelado' :
                             (payload.data.status as string) || 'vigente';

            const { data: integration } = await admin.from('integrations')
              .select('company_id')
              .eq('syntage_taxpayer_id', payload.data.taxpayer_id as string)
              .eq('provider', 'syntage').single();

            if (integration) {
              // Check if invoice exists
              const { data: existing } = await admin.from('invoices')
                .select('id').eq('uuid', uuid).eq('company_id', integration.company_id).single();

              if (existing) {
                await admin.from('invoices').update({
                  sat_status: satStatus,
                  efos_status: (payload.data.efos_status as string) || null,
                  cancellable: (payload.data.cancellable as boolean) || null,
                  validated_at: new Date().toISOString(),
                }).eq('id', existing.id);
              } else {
                await admin.from('invoices').insert({
                  company_id: integration.company_id, uuid, sat_status: satStatus,
                  efos_status: (payload.data.efos_status as string) || null,
                  syntage_invoice_id: payload.data.id as string,
                  source: 'sat',
                  type: (payload.data.type as string) === 'egreso' ? 'out_invoice' : 'in_invoice',
                  amount_total: (payload.data.total as number) || 0,
                  amount_paid: 0, amount_residual: (payload.data.total as number) || 0,
                  invoice_date: (payload.data.issued_at as string)?.split('T')[0] || new Date().toISOString().split('T')[0],
                  issuer_rfc: payload.data.issuer_rfc as string || null,
                  receiver_rfc: payload.data.receiver_rfc as string || null,
                  validated_at: new Date().toISOString(),
                });
              }

              // Check EFOS
              if ((payload.data.efos_status as string) === 'definitivo') {
                const issuerRfc = payload.data.issuer_rfc as string;
                if (issuerRfc) {
                  await admin.from('vendors').update({ efos_status: 'definitivo' })
                    .eq('company_id', integration.company_id).eq('rfc', issuerRfc.toUpperCase());

                  const { data: admins } = await admin.from('user_companies')
                    .select('user_id').eq('company_id', integration.company_id).eq('role', 'admin');
                  for (const a of (admins || [])) {
                    await admin.from('notifications').insert({
                      company_id: integration.company_id, user_id: a.user_id,
                      event_type: 'vendor.efos_detected',
                      title: 'Proveedor en lista EFOS',
                      message: `RFC ${issuerRfc} detectado en lista EFOS definitiva`,
                      read: false,
                    });
                  }
                }
              }
            }
          }
          break;
        }

        case 'tax_status.updated':
        case 'tax_compliance_check.created':
          // Log only - already captured in webhook_logs
          break;
      }

      if (webhookLog) {
        await admin.from('webhook_logs').update({ processed: true }).eq('id', webhookLog.id);
      }
    } catch (err) {
      if (webhookLog) {
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
