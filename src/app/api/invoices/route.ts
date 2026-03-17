import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { invoiceCreateSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';
import { parsePaginationParams } from '@/lib/utils/response';

// GET /api/invoices
export const GET = createHandler(async (req) => {
  return withAuth(withRbac('invoices.read', async (_req, ctx) => {
    const url = new URL(_req.url);
    const { page, limit, sort, search } = parsePaginationParams(url);
    const offset = (page - 1) * limit;
    const admin = getAdminClient();

    let query = admin
      .from('invoices')
      .select('*, vendors:vendor_id(id, name, rfc), customers:customer_id(id, name, rfc)', { count: 'exact' })
      .eq('company_id', ctx.company_id);

    const type = url.searchParams.get('type');
    if (type) query = query.eq('type', type);

    const satStatus = url.searchParams.get('sat_status');
    if (satStatus) query = query.eq('sat_status', satStatus);

    const paymentStatus = url.searchParams.get('payment_status');
    if (paymentStatus === 'paid') query = query.eq('amount_residual', 0);
    else if (paymentStatus === 'partial') query = query.gt('amount_paid', 0).gt('amount_residual', 0);
    else if (paymentStatus === 'unpaid') query = query.eq('amount_paid', 0);

    const paymentMethod = url.searchParams.get('payment_method');
    if (paymentMethod) query = query.eq('payment_method', paymentMethod);

    const vendorId = url.searchParams.get('vendor_id');
    if (vendorId) query = query.eq('vendor_id', vendorId);

    const customerId = url.searchParams.get('customer_id');
    if (customerId) query = query.eq('customer_id', customerId);

    const source = url.searchParams.get('source');
    if (source) query = query.eq('source', source);

    const overdue = url.searchParams.get('overdue');
    if (overdue === 'true') {
      const today = new Date().toISOString().split('T')[0];
      // Check both date_due (seed/manual) and due_date (Odoo sync) columns
      query = query.or(`due_date.lt.${today},date_due.lt.${today}`).gt('amount_residual', 0);
    }

    if (search) {
      query = query.or(`invoice_number.ilike.%${search}%,uuid.ilike.%${search}%,issuer_rfc.ilike.%${search}%`);
    }

    const [sortField, sortDir] = sort.split(':');
    query = query.order(sortField || 'created_at', { ascending: sortDir === 'asc' });
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw new ApiError('INTERNAL_ERROR', 'Error al obtener facturas', 500);

    return Response.json({
      data: data || [],
      meta: { total: count || 0, page, limit },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });

// POST /api/invoices
export const POST = createHandler(async (req) => {
  return withAuth(withRbac('invoices.create', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = invoiceCreateSchema.safeParse(body);
    if (!result.success) {
      throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400, {
        fields: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const data = result.data;
    const admin = getAdminClient();

    // Check UUID uniqueness
    if (data.uuid) {
      const { data: existing } = await admin
        .from('invoices')
        .select('id')
        .eq('uuid', data.uuid)
        .single();

      if (existing) throw new ApiError('DUPLICATE', 'Ya existe una factura con este UUID', 409);
    }

    const { data: invoice, error } = await admin
      .from('invoices')
      .insert({
        company_id: ctx.company_id,
        type: data.type,
        vendor_id: data.vendor_id || null,
        customer_id: data.customer_id || null,
        invoice_number: data.invoice_number || null,
        uuid: data.uuid || null,
        issuer_rfc: data.issuer_rfc || null,
        receiver_rfc: data.receiver_rfc || null,
        invoice_date: data.invoice_date,
        due_date: data.due_date || null,
        amount_total: data.amount_total,
        amount_paid: 0,
        amount_residual: data.amount_total,
        currency: data.currency,
        payment_method: data.payment_method || null,
        sat_status: 'no_validado',
        source: data.source,
      })
      .select()
      .single();

    if (error) throw new ApiError('INTERNAL_ERROR', 'Error al crear factura', 500);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'invoice.created',
      entity_type: 'invoice',
      entity_id: invoice.id,
      changes: { after: invoice },
    });

    return Response.json({ data: invoice }, { status: 201 });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
