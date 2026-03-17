import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { paymentCreateSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';
import { parsePaginationParams } from '@/lib/utils/response';

// GET /api/payments - List payments
export const GET = createHandler(async (req) => {
  return withAuth(withRbac('payments.read', async (_req, ctx) => {
    const url = new URL(_req.url);
    const { page, limit, sort, search } = parsePaginationParams(url);
    const offset = (page - 1) * limit;

    const admin = getAdminClient();
    let query = admin
      .from('payments')
      .select('*, vendors:vendor_id(id, name, rfc)', { count: 'exact' })
      .eq('company_id', ctx.company_id);

    // Filters
    const status = url.searchParams.get('status');
    if (status) {
      const statuses = status.split(',');
      query = query.in('status', statuses);
    }

    const vendorId = url.searchParams.get('vendor_id');
    if (vendorId) query = query.eq('vendor_id', vendorId);

    const dateFrom = url.searchParams.get('date_from');
    if (dateFrom) query = query.gte('created_at', dateFrom);

    const dateTo = url.searchParams.get('date_to');
    if (dateTo) query = query.lte('created_at', dateTo);

    const amountMin = url.searchParams.get('amount_min');
    if (amountMin && !isNaN(parseFloat(amountMin))) query = query.gte('amount', parseFloat(amountMin));

    const amountMax = url.searchParams.get('amount_max');
    if (amountMax && !isNaN(parseFloat(amountMax))) query = query.lte('amount', parseFloat(amountMax));

    if (search) {
      query = query.or(`concept.ilike.%${search}%,beneficiary_name.ilike.%${search}%,reference.ilike.%${search}%`);
    }

    // Sorting
    const [sortField, sortDir] = sort.split(':');
    query = query.order(sortField || 'created_at', { ascending: sortDir === 'asc' });
    query = query.range(offset, offset + limit - 1);

    const { data: payments, count, error } = await query;
    if (error) throw new ApiError('INTERNAL_ERROR', 'Error al obtener pagos', 500);

    // Map beneficiary_name -> partner_name for frontend compatibility
    const mapped = (payments || []).map((p: Record<string, unknown>) => ({
      ...p,
      partner_name: p.partner_name ?? p.beneficiary_name ?? null,
    }));

    return Response.json({
      data: mapped,
      meta: { total: count || 0, page, limit },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });

// POST /api/payments - Create payment
export const POST = createHandler(async (req) => {
  return withAuth(withRbac('payments.create', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = paymentCreateSchema.safeParse(body);
    if (!result.success) {
      throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400, {
        fields: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const { vendor_id, invoice_id, amount, concept, reference, scheduled_date } = result.data;
    const admin = getAdminClient();

    // Fetch vendor
    const { data: vendor, error: vendorError } = await admin
      .from('vendors')
      .select('*')
      .eq('id', vendor_id)
      .eq('company_id', ctx.company_id)
      .single();

    if (vendorError || !vendor) throw new ApiError('NOT_FOUND', 'Proveedor no encontrado', 404);
    if (vendor.efos_status === 'definitivo') throw new ApiError('VENDOR_EFOS_BLOCKED', 'Proveedor en lista EFOS definitiva', 422);
    if (!vendor.clabe) throw new ApiError('VENDOR_NO_CLABE', 'Proveedor no tiene CLABE registrada', 422);

    // Validate invoice if provided
    let paymentAmount = amount;
    if (invoice_id) {
      const { data: invoice } = await admin
        .from('invoices')
        .select('*')
        .eq('id', invoice_id)
        .eq('company_id', ctx.company_id)
        .single();

      if (!invoice) throw new ApiError('NOT_FOUND', 'Factura no encontrada', 404);
      if (invoice.amount_residual <= 0) throw new ApiError('VALIDATION_ERROR', 'Factura ya pagada', 422);
      if (!paymentAmount) paymentAmount = invoice.amount_residual;
    }

    // Check approval rules
    let paymentStatus = scheduled_date ? 'scheduled' : 'draft';
    let approvalRequest = null;

    const { data: rules } = await admin
      .from('approval_rules')
      .select('*')
      .eq('company_id', ctx.company_id)
      .eq('is_active', true)
      .lte('amount_min', paymentAmount)
      .order('amount_min', { ascending: false });

    const matchingRule = rules?.find(r =>
      paymentAmount >= r.amount_min && (!r.amount_max || paymentAmount <= r.amount_max)
    );

    if (matchingRule && !matchingRule.auto_approve) {
      paymentStatus = 'pending_approval';
    }

    // Create payment
    const { data: payment, error: createError } = await admin
      .from('payments')
      .insert({
        company_id: ctx.company_id,
        direction: 'outbound',
        vendor_id,
        invoice_id: invoice_id || null,
        amount: paymentAmount,
        currency: 'MXN',
        beneficiary_name: vendor.name,
        clabe: vendor.clabe,
        concept,
        reference: reference || null,
        status: paymentStatus,
        scheduled_date: scheduled_date || null,
        created_by: ctx.user_id,
      })
      .select()
      .single();

    if (createError) throw new ApiError('INTERNAL_ERROR', 'Error al crear pago', 500);

    // Create approval request if needed
    if (matchingRule && !matchingRule.auto_approve) {
      const { data: approval } = await admin
        .from('approval_requests')
        .insert({
          company_id: ctx.company_id,
          entity_type: 'payment',
          entity_id: payment.id,
          rule_id: matchingRule.id,
          amount: paymentAmount,
          requested_by: ctx.user_id,
          status: 'pending',
        })
        .select()
        .single();

      approvalRequest = approval;

      // Notify approvers
      const approvers = Array.isArray(matchingRule.approvers) ? matchingRule.approvers : [];
      for (const approverId of approvers) {
        await admin.from('notifications').insert({
          company_id: ctx.company_id,
          user_id: approverId,
          event_type: 'payment.needs_approval',
          entity_type: 'payment',
          entity_id: payment.id,
          title: `Aprobacion requerida: $${paymentAmount}`,
          message: `${ctx.email} solicita aprobar un pago de $${paymentAmount} a ${vendor.name}`,
          read: false,
        });
      }
    }

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'payment.created',
      entity_type: 'payment',
      entity_id: payment.id,
      changes: { after: payment },
    });

    return Response.json({ data: { ...payment, approval_request: approvalRequest } }, { status: 201 });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
