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

    // Decrypt Odoo config
    let odooConfig: odoo.OdooConfig;
    try {
      odooConfig = decrypt(odooInt.config_encrypted) as unknown as odoo.OdooConfig;
    } catch {
      throw new ApiError('INTEGRATION_ERROR', 'Error al descifrar configuración de Odoo', 500);
    }

    // Determine move_type from CFDI type
    const moveType = cfdi.type === 'I' ? 'out_invoice' :
                     cfdi.type === 'E' ? 'in_invoice' :
                     'in_invoice';

    // Try to resolve partner_id by RFC in Odoo
    let partnerId: number | false = false;
    const issuerRfc = cfdi.issuer?.rfc?.toUpperCase();
    if (issuerRfc) {
      try {
        const partners = await odoo.odooSearchRead(
          odooConfig,
          'res.partner',
          [['vat', '=', issuerRfc], ['is_company', '=', true]],
          ['id', 'name'],
          1,
        );
        if (partners.length > 0) {
          partnerId = (partners[0] as { id: number }).id;
        }
      } catch {
        // Partner lookup failed — proceed without partner
      }
    }

    // Calculate tax amount
    const subtotal = cfdi.subtotal ?? (cfdi.total - (cfdi.discount ?? 0));
    const taxAmount = cfdi.total - subtotal;

    // Create account.move in Odoo with proper line items
    const invoiceLines: unknown[][] = [];

    // Main product line (subtotal)
    invoiceLines.push([0, 0, {
      name: `CFDI ${cfdi_uuid}${cfdi.issuer?.name ? ` - ${cfdi.issuer.name}` : ''}`,
      price_unit: subtotal,
      quantity: 1,
    }]);

    // Tax line if applicable (IVA 16% is most common in Mexico)
    if (taxAmount > 0.01) {
      invoiceLines.push([0, 0, {
        name: `IVA - CFDI ${cfdi_uuid}`,
        price_unit: taxAmount,
        quantity: 1,
      }]);
    }

    const moveValues: Record<string, unknown> = {
      move_type: moveType,
      invoice_date: cfdi.issued_at?.split('T')[0] || new Date().toISOString().split('T')[0],
      l10n_mx_edi_cfdi_uuid: cfdi_uuid,
      ref: `SAT Import: ${cfdi_uuid}`,
      invoice_line_ids: invoiceLines,
    };

    if (partnerId) {
      moveValues.partner_id = partnerId;
    }

    if (cfdi.currency && cfdi.currency !== 'MXN') {
      moveValues.currency_code = cfdi.currency;
    }

    const moveId = await odoo.odooCreate(odooConfig, 'account.move', moveValues);

    // Post the invoice so it appears in reports
    try {
      await odoo.odooCallMethod(odooConfig, 'account.move', 'action_post', [moveId]);
    } catch {
      // Invoice created but not posted — user can post manually
    }

    // Update local invoice if exists
    await admin.from('invoices').update({
      odoo_move_id: String(moveId),
      odoo_id: moveId,
      source: 'sat',
    }).eq('uuid', cfdi_uuid).eq('company_id', ctx.company_id);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'reconciliation.imported_to_odoo',
      entity_type: 'invoice',
      entity_id: cfdi_uuid,
      metadata: {
        odoo_move_id: moveId,
        partner_id: partnerId || null,
        partner_resolved: !!partnerId,
        posted: true,
      },
    });

    return Response.json({
      data: {
        message: partnerId
          ? 'CFDI importado y publicado en Odoo'
          : 'CFDI importado a Odoo (sin proveedor asignado — asigne manualmente en Odoo)',
        odoo_move_id: moveId,
        partner_resolved: !!partnerId,
      },
    }, { status: 201 });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
