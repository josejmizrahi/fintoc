import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';

export const GET = createHandler(async (req) => {
  return withAuth(async (_req, ctx) => {
    const url = new URL(_req.url);
    const rawQ = url.searchParams.get('q');
    if (!rawQ || rawQ.length < 2) throw new ApiError('VALIDATION_ERROR', 'Busqueda debe tener al menos 2 caracteres', 400);

    // Strip characters that could manipulate PostgREST .or() filter expressions
    const q = rawQ.replace(/[,().\\]/g, '').trim().slice(0, 100);
    if (q.length < 2) throw new ApiError('VALIDATION_ERROR', 'Busqueda debe tener al menos 2 caracteres', 400);

    const admin = getAdminClient();
    const search = `%${q}%`;

    const [paymentsRes, invoicesRes, vendorsRes, customersRes] = await Promise.all([
      admin.from('payments').select('id, beneficiary_name, amount, status, concept')
        .eq('company_id', ctx.company_id)
        .or(`concept.ilike.${search},beneficiary_name.ilike.${search},reference.ilike.${search}`)
        .limit(5),
      admin.from('invoices').select('id, invoice_number, uuid, amount_total, type')
        .eq('company_id', ctx.company_id)
        .or(`invoice_number.ilike.${search},uuid.ilike.${search},issuer_rfc.ilike.${search}`)
        .limit(5),
      admin.from('vendors').select('id, name, rfc')
        .eq('company_id', ctx.company_id)
        .or(`name.ilike.${search},rfc.ilike.${search}`)
        .limit(5),
      admin.from('customers').select('id, name, rfc')
        .eq('company_id', ctx.company_id)
        .or(`name.ilike.${search},rfc.ilike.${search}`)
        .limit(5),
    ]);

    return Response.json({
      data: {
        payments: paymentsRes.data || [],
        invoices: invoicesRes.data || [],
        vendors: vendorsRes.data || [],
        customers: customersRes.data || [],
      },
    });
  })(req, { params: Promise.resolve({}) });
});
