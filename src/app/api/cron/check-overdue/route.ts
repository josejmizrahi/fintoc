import { getAdminClient } from '@/lib/supabase/admin';

export async function GET(req: Request): Promise<Response> {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
    for (const invoice of (newlyOverdue || [])) {
      await admin.from('invoices').update({ payment_status: 'overdue' }).eq('id', invoice.id);

      // Notify admins
      const { data: admins } = await admin.from('user_companies')
        .select('user_id').eq('company_id', invoice.company_id).eq('role', 'admin');

      for (const a of (admins || [])) {
        await admin.from('notifications').insert({
          company_id: invoice.company_id, user_id: a.user_id,
          event_type: 'invoice.overdue', entity_type: 'invoice', entity_id: invoice.id,
          title: 'Factura vencida',
          message: `Factura ${invoice.invoice_number || invoice.id} por $${invoice.amount_residual} está vencida`,
          read: false,
        });
      }
      updated++;
    }

    return Response.json({ data: { checked: (newlyOverdue || []).length, updated } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
