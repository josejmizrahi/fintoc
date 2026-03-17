import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { importToOdooSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';
import * as syntage from '@/lib/integrations/syntage';
import * as odoo from '@/lib/integrations/odoo';
import { decrypt } from '@/lib/utils/crypto';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('reconciliation.execute', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = importToOdooSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const { cfdi_uuid } = result.data;
    const admin = getAdminClient();

    // Get integrations
    const { data: syntageInt } = await admin
      .from('integrations')
      .select('syntage_taxpayer_id')
      .eq('company_id', ctx.company_id)
      .eq('provider', 'sat')
      .single();

    const { data: odooInt } = await admin
      .from('integrations')
      .select('config_encrypted')
      .eq('company_id', ctx.company_id)
      .eq('provider', 'odoo')
      .single();

    if (!syntageInt?.syntage_taxpayer_id) throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado', 422);
    if (!odooInt?.config_encrypted) throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Odoo no configurado', 422);

    // Fetch CFDI from Syntage
    const invoices = await syntage.getInvoices(syntageInt.syntage_taxpayer_id, {
      uuid: [cfdi_uuid],
    });

    const cfdi = invoices?.[0];
    if (!cfdi) throw new ApiError('NOT_FOUND', 'CFDI no encontrado en SAT', 404);

    // Create account.move in Odoo
    const odooConfig = decrypt(odooInt.config_encrypted) as unknown as odoo.OdooConfig;
    const moveId = await odoo.odooCreate(odooConfig, 'account.move', {
      move_type: 'in_invoice',
      invoice_date: cfdi.issued_at,
      l10n_mx_edi_cfdi_uuid: cfdi_uuid,
      partner_id: false, // Must be set manually or looked up
      invoice_line_ids: [[0, 0, {
        name: `CFDI ${cfdi_uuid}`,
        price_unit: cfdi.total,
        quantity: 1,
      }]],
    });

    // Update local invoice if exists
    await admin.from('invoices').update({
      odoo_move_id: String(moveId),
      source: 'sat',
    }).eq('uuid', cfdi_uuid).eq('company_id', ctx.company_id);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'reconciliation.imported_to_odoo',
      entity_type: 'invoice',
      entity_id: cfdi_uuid,
      metadata: { odoo_move_id: moveId },
    });

    return Response.json({
      data: { message: 'CFDI importado a Odoo', odoo_move_id: moveId },
    }, { status: 201 });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
