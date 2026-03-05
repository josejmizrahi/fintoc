import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { customerCreateSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';
import { parsePaginationParams } from '@/lib/utils/response';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('customers.read', async (_req, ctx) => {
    const url = new URL(_req.url);
    const { page, limit, search } = parsePaginationParams(url);
    const offset = (page - 1) * limit;
    const admin = getAdminClient();

    let query = admin
      .from('customers')
      .select('*', { count: 'exact' })
      .eq('company_id', ctx.company_id);

    if (search) query = query.or(`name.ilike.%${search}%,rfc.ilike.%${search}%`);
    query = query.order('name').range(offset, offset + limit - 1);

    const { data, count } = await query;
    return Response.json({ data: data || [], meta: { total: count || 0, page, limit } });
  }))(req, { params: Promise.resolve({}) });
});

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('customers.write', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = customerCreateSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const admin = getAdminClient();
    if (result.data.rfc) {
      const { data: existing } = await admin
        .from('customers')
        .select('id')
        .eq('company_id', ctx.company_id)
        .eq('rfc', result.data.rfc.toUpperCase())
        .single();

      if (existing) throw new ApiError('DUPLICATE', 'Ya existe un cliente con este RFC', 409);
    }

    const { data: customer, error } = await admin
      .from('customers')
      .insert({
        company_id: ctx.company_id,
        name: result.data.name,
        rfc: result.data.rfc?.toUpperCase() || null,
        email: result.data.email || null,
        phone: result.data.phone || null,
      })
      .select()
      .single();

    if (error) throw new ApiError('INTERNAL_ERROR', 'Error al crear cliente', 500);

    await writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'customer.created',
      entity_type: 'customer',
      entity_id: customer.id,
    });

    return Response.json({ data: customer }, { status: 201 });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
