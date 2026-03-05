import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/utils/crypto';
import * as odoo from '@/lib/integrations/odoo';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('sync.execute', async (_req, ctx) => {
    const admin = getAdminClient();

    const { data: integration } = await admin.from('integrations').select('config_encrypted')
      .eq('company_id', ctx.company_id).eq('provider', 'odoo').single();

    if (!integration?.config_encrypted) throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Odoo no configurado', 422);

    const config = decrypt(integration.config_encrypted) as unknown as odoo.OdooConfig;

    // Create sync history entry
    const { data: syncEntry } = await admin.from('sync_history').insert({
      company_id: ctx.company_id, provider: 'odoo', status: 'running',
    }).select().single();

    let recordsSynced = 0;
    try {
      // Sync vendors
      const vendors = await odoo.fetchOdooVendors(config);
      for (const v of vendors as Record<string, unknown>[]) {
        const rfc = ((v.vat as string) || '').toUpperCase();
        if (!rfc) continue;
        await admin.from('vendors').upsert({
          company_id: ctx.company_id, name: v.name as string, rfc, email: v.email as string || null,
          odoo_id: String(v.id), synced_at: new Date().toISOString(),
        }, { onConflict: 'company_id,rfc' });
        recordsSynced++;
      }

      // Sync customers
      const customers = await odoo.fetchOdooCustomers(config);
      for (const c of customers as Record<string, unknown>[]) {
        const rfc = ((c.vat as string) || '').toUpperCase();
        if (!rfc) continue;
        await admin.from('customers').upsert({
          company_id: ctx.company_id, name: c.name as string, rfc, email: c.email as string || null,
          odoo_id: String(c.id),
        }, { onConflict: 'company_id,rfc' });
        recordsSynced++;
      }

      // Sync invoices
      const invoices = await odoo.fetchOdooInvoices(config);
      for (const inv of invoices as Record<string, unknown>[]) {
        const uuid = inv.l10n_mx_edi_cfdi_uuid as string;
        await admin.from('invoices').upsert({
          company_id: ctx.company_id,
          type: inv.move_type as string,
          invoice_number: inv.name as string,
          uuid: uuid || null,
          invoice_date: inv.invoice_date as string,
          due_date: inv.invoice_date_due as string,
          amount_total: inv.amount_total as number,
          amount_residual: inv.amount_residual as number,
          amount_paid: (inv.amount_total as number) - (inv.amount_residual as number),
          payment_method: inv.l10n_mx_edi_payment_policy as string || null,
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
        .eq('company_id', ctx.company_id).eq('provider', 'odoo');

      return Response.json({ data: { status: 'completed', records_synced: recordsSynced } });
    } catch (err) {
      await admin.from('sync_history').update({
        status: 'failed', error_message: err instanceof Error ? err.message : 'Unknown', completed_at: new Date().toISOString(),
      }).eq('id', syncEntry?.id);
      throw new ApiError('ODOO_ERROR', 'Error al sincronizar con Odoo', 502);
    }
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'batch' });
