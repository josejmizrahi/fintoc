import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { sendReminderSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';
import { sendCollectionReminder } from '@/lib/email';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('collections.write', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = sendReminderSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const { invoice_id, to_email, subject, body: emailBody } = result.data;
    const admin = getAdminClient();

    const { data: invoice } = await admin
      .from('invoices')
      .select('id, invoice_number, amount_residual, due_date, partner_name')
      .eq('id', invoice_id)
      .eq('company_id', ctx.company_id)
      .single();

    if (!invoice) throw new ApiError('NOT_FOUND', 'Factura no encontrada', 404);

    const { data: company } = await admin
      .from('companies')
      .select('name')
      .eq('id', ctx.company_id)
      .single();

    const sent = await sendCollectionReminder({
      to: to_email,
      customerName: invoice.partner_name || to_email,
      invoiceNumber: invoice.invoice_number || `#${invoice.id}`,
      amount: invoice.amount_residual || 0,
      dueDate: invoice.due_date || 'Sin fecha',
      companyName: company?.name || 'Quimibond',
      customMessage: emailBody !== subject ? emailBody : undefined,
    });

    if (!sent) {
      throw new ApiError('EMAIL_ERROR', 'Error al enviar email. Verifica que RESEND_API_KEY este configurada.', 502);
    }

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'collection.reminder_sent',
      entity_type: 'invoice',
      entity_id: invoice_id,
      metadata: { to_email, subject },
    });

    return Response.json({ data: { message: `Recordatorio enviado a ${to_email}` } });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
