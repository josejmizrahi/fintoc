import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { expenseCreateSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/middleware/audit';
import { parsePaginationParams } from '@/lib/utils/response';

export const GET = createHandler(async (req) => {
  return withAuth(withRbac('expenses.read', async (_req, ctx) => {
    const url = new URL(_req.url);
    const { page, limit } = parsePaginationParams(url);
    const offset = (page - 1) * limit;
    const admin = getAdminClient();

    let query = admin.from('expenses').select('*', { count: 'exact' }).eq('company_id', ctx.company_id);

    const status = url.searchParams.get('status');
    if (status) query = query.eq('status', status);
    const category = url.searchParams.get('category');
    if (category) query = query.eq('category', category);
    const employee = url.searchParams.get('employee_name');
    if (employee) query = query.ilike('employee_name', `%${employee}%`);

    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    const { data, count } = await query;

    return Response.json({ data: data || [], meta: { total: count || 0, page, limit } });
  }))(req, { params: Promise.resolve({}) });
});

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('expenses.write', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = expenseCreateSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const admin = getAdminClient();
    const { data: expense, error } = await admin.from('expenses').insert({
      company_id: ctx.company_id,
      employee_name: result.data.employee_name,
      category: result.data.category,
      description: result.data.description || null,
      amount: result.data.amount,
      currency: 'MXN',
      xml_url: result.data.xml_url || null,
      status: 'pending',
      created_by: ctx.user_id,
    }).select().single();

    if (error) throw new ApiError('INTERNAL_ERROR', 'Error al crear gasto', 500);

    await writeAuditLog({ company_id: ctx.company_id, user_id: ctx.user_id, action: 'expense.created', entity_type: 'expense', entity_id: expense.id });
    return Response.json({ data: expense }, { status: 201 });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
