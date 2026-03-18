import { getAdminClient } from '@/lib/supabase/admin';
import { verifyCronSecret } from '@/lib/middleware/cron-auth';
import { sendOverdueAlert } from '@/lib/email';

export async function GET(req: Request): Promise<Response> {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const admin = getAdminClient();
  const today = new Date().toISOString().split('T')[0];

  try {
    // Find invoices that just became overdue
    const { data: newlyOverdue } = await admin.from('invoices')
      .select('id, company_id, invoice_number, amount_residual, due_date, type')
      .lt('due_date', today)
      .gt('amount_residual', 0)
      .neq('payment_status', 'overdue')
      .in('type', ['payable', 'receivable']);

    let updated = 0;
    // Group by company for batch notifications
    const byCompany = new Map<number, typeof newlyOverdue>();

    for (const invoice of (newlyOverdue || [])) {
      await admin.from('invoices').update({ payment_status: 'overdue' }).eq('id', invoice.id);

      const existing = byCompany.get(invoice.company_id);
      if (existing) {
        existing.push(invoice);
      } else {
        byCompany.set(invoice.company_id, [invoice]);
      }
      updated++;
    }

    // Send grouped notifications per company
    for (const [companyId, invoices] of byCompany) {
      const totalAmount = invoices.reduce((s, i) => s + (i.amount_residual || 0), 0);

      // In-app notifications
      const { data: admins } = await admin.from('user_companies')
        .select('user_id').eq('company_id', companyId).eq('role', 'admin');

      for (const a of (admins || [])) {
        await admin.from('notifications').insert({
          company_id: companyId, user_id: a.user_id,
          event_type: 'invoice.overdue', entity_type: 'invoice', entity_id: String(companyId),
          title: `${invoices.length} factura${invoices.length > 1 ? 's' : ''} vencida${invoices.length > 1 ? 's' : ''}`,
          message: `Tienes ${invoices.length} factura${invoices.length > 1 ? 's' : ''} vencida${invoices.length > 1 ? 's' : ''} por $${totalAmount.toLocaleString('es-MX')}`,
          read: false,
        });
      }

      // Email alerts to admins (best-effort, never fails the cron)
      try {
        const { data: company } = await admin.from('companies').select('name').eq('id', companyId).single();
        const { data: adminUsers } = await admin.from('user_companies')
          .select('user_id')
          .eq('company_id', companyId)
          .eq('role', 'admin');

        for (const au of (adminUsers || [])) {
          try {
            const { data: authUser } = await admin.auth.admin.getUserById(au.user_id);
            if (authUser?.user?.email) {
              sendOverdueAlert({
                to: authUser.user.email,
                userName: authUser.user.user_metadata?.full_name || authUser.user.email,
                overdueCount: invoices.length,
                totalAmount,
                companyName: company?.name || 'Tu empresa',
              }).catch(() => {});
            }
          } catch {
            // Auth lookup failed — skip email for this user
          }
        }
      } catch {
        // Email sending failed — notifications already created above
      }
    }

    return Response.json({ data: { checked: (newlyOverdue || []).length, updated } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
