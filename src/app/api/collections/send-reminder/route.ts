import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { sendReminderSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';

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
      .select('id')
      .eq('id', invoice_id)
      .eq('company_id', ctx.company_id)
      .single();

    if (!invoice) throw new ApiError('NOT_FOUND', 'Factura no encontrada', 404);

    // Send email via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const { Resend } = await import('resend');
      const resend = new Resend(resendKey);
      await resend.emails.send({
        from: 'cobros@fintoc.app',
        to: to_email,
        subject,
        text: emailBody,
      });
    }

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'collection.reminder_sent',
      entity_type: 'invoice',
      entity_id: invoice_id,
      metadata: { to_email, subject },
    });

    return Response.json({ data: { message: 'Recordatorio enviado' } });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
