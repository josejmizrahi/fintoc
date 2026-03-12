import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { createClabeSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { createAccountNumber } from '@/lib/integrations/fintoc';
import { writeAuditLog } from '@/lib/middleware/audit';

export const POST = createHandler(async (req) => {
  return withAuth(withRbac('customers.write', async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = createClabeSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'customer_id invalido', 400);

    const admin = getAdminClient();

    const { data: customer } = await admin
      .from('customers')
      .select('*')
      .eq('id', result.data.customer_id)
      .eq('company_id', ctx.company_id)
      .single();

    if (!customer) throw new ApiError('NOT_FOUND', 'Cliente no encontrado', 404);

    const { data: company } = await admin.from('companies').select('name').eq('id', ctx.company_id).single();

    const accountNumber = (await createAccountNumber(
      company?.name || 'Company',
      customer.name
    )) as { id: string; number: string };

    await admin.from('customers').update({
      fintoc_clabe: accountNumber.number,
      fintoc_account_id: accountNumber.id,
    }).eq('id', result.data.customer_id);

    writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'customer.clabe_created',
      entity_type: 'customer',
      entity_id: result.data.customer_id,
      metadata: { clabe: accountNumber.number, fintoc_account_id: accountNumber.id },
    });

    return Response.json({
      data: { clabe: accountNumber.number, fintoc_account_id: accountNumber.id },
    }, { status: 201 });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
