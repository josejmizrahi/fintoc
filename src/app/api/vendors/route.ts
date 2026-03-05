import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { vendorCreateSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';
import { parsePaginationParams } from '@/lib/utils/response';
import { getBankFromCLABE } from '@/lib/utils/format';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('vendors.read', async (_req, ctx) => {
    const url = new URL(_req.url);
    const { page, limit, search } = parsePaginationParams(url);
    const offset = (page - 1) * limit;
    const admin = getAdminClient();

    let query = admin
      .from('vendors')
      .select('*', { count: 'exact' })
      .eq('company_id', ctx.company_id);

    if (search) query = query.or(`name.ilike.%${search}%,rfc.ilike.%${search}%`);

    const efos = url.searchParams.get('efos_status');
    if (efos) query = query.eq('efos_status', efos);

    const clabeVerified = url.searchParams.get('clabe_verified');
    if (clabeVerified === 'true') query = query.eq('clabe_verified', true);
    if (clabeVerified === 'false') query = query.eq('clabe_verified', false);

    query = query.order('name').range(offset, offset + limit - 1);

    const { data, count } = await query;

    return Response.json({
      data: data || [],
      meta: { total: count || 0, page, limit },
    });
  }))(req, { params: Promise.resolve({}) });
});

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('vendors.write', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = vendorCreateSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400, {
      fields: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });

    const data = result.data;
    const admin = getAdminClient();

    // Check RFC uniqueness
    if (data.rfc) {
      const { data: existing } = await admin
        .from('vendors')
        .select('id')
        .eq('company_id', ctx.company_id)
        .eq('rfc', data.rfc.toUpperCase())
        .single();

      if (existing) throw new ApiError('DUPLICATE', 'Ya existe un proveedor con este RFC', 409);
    }

    const bankName = data.clabe ? getBankFromCLABE(data.clabe) : null;

    const { data: vendor, error } = await admin
      .from('vendors')
      .insert({
        company_id: ctx.company_id,
        name: data.name,
        rfc: data.rfc?.toUpperCase() || null,
        email: data.email || null,
        phone: data.phone || null,
        clabe: data.clabe || null,
        bank_name: bankName,
      })
      .select()
      .single();

    if (error) throw new ApiError('INTERNAL_ERROR', 'Error al crear proveedor', 500);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'vendor.created',
      entity_type: 'vendor',
      entity_id: vendor.id,
      changes: { after: vendor },
    });

    return Response.json({ data: vendor }, { status: 201 });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
