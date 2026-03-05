import { getAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/utils/crypto';
import * as odoo from '@/lib/integrations/odoo';

export async function GET(req: Request): Promise<Response> {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();
  const results: Array<{ company_id: string; status: string; records_synced?: number; error?: string }> = [];

  try {
    const { data: integrations } = await admin.from('integrations')
      .select('company_id, config_encrypted')
      .eq('provider', 'odoo')
      .eq('status', 'valid');

    for (const integration of (integrations || [])) {
      if (!integration.config_encrypted) continue;

      try {
        const config = decrypt(integration.config_encrypted) as unknown as odoo.OdooConfig;
        let recordsSynced = 0;

        const { data: syncEntry } = await admin.from('sync_history').insert({
          company_id: integration.company_id, provider: 'odoo', status: 'running',
        }).select().single();

        // Sync vendors
        const vendors = await odoo.fetchOdooVendors(config);
        for (const v of vendors as Record<string, unknown>[]) {
          const rfc = ((v.vat as string) || '').toUpperCase();
          if (!rfc) continue;
          await admin.from('vendors').upsert({
            company_id: integration.company_id, name: v.name as string, rfc,
            email: v.email as string || null, odoo_id: String(v.id),
            synced_at: new Date().toISOString(),
          }, { onConflict: 'company_id,rfc' });
          recordsSynced++;
        }

        // Sync customers
        const customers = await odoo.fetchOdooCustomers(config);
        for (const c of customers as Record<string, unknown>[]) {
          const rfc = ((c.vat as string) || '').toUpperCase();
          if (!rfc) continue;
          await admin.from('customers').upsert({
            company_id: integration.company_id, name: c.name as string, rfc,
            email: c.email as string || null, odoo_id: String(c.id),
          }, { onConflict: 'company_id,rfc' });
          recordsSynced++;
        }

        // Sync invoices
        const invoices = await odoo.fetchOdooInvoices(config);
        for (const inv of invoices as Record<string, unknown>[]) {
          const uuid = inv.l10n_mx_edi_cfdi_uuid as string;
          await admin.from('invoices').upsert({
            company_id: integration.company_id,
            type: inv.move_type as string,
            invoice_number: inv.name as string,
            uuid: uuid || null,
            invoice_date: inv.invoice_date as string,
            due_date: inv.invoice_date_due as string,
            amount_total: inv.amount_total as number,
            amount_residual: inv.amount_residual as number,
            amount_paid: (inv.amount_total as number) - (inv.amount_residual as number),
            odoo_move_id: String(inv.id),
            source: 'odoo',
            sat_status: 'no_validado',
          }, { onConflict: 'odoo_move_id', ignoreDuplicates: false });
          recordsSynced++;
        }

        await admin.from('sync_history').update({
          status: 'completed', records_synced: recordsSynced, completed_at: new Date().toISOString(),
        }).eq('id', syncEntry?.id);

        await admin.from('integrations').update({ last_sync: new Date().toISOString() })
          .eq('company_id', integration.company_id).eq('provider', 'odoo');

        results.push({ company_id: integration.company_id, status: 'completed', records_synced: recordsSynced });
      } catch (err) {
        results.push({
          company_id: integration.company_id, status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return Response.json({ data: { processed: results.length, results } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
