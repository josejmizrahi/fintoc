import { createClient } from '@supabase/supabase-js';
import { createHandler } from '@/lib/middleware/route-handler';
import { loginSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/middleware/rate-limit';

export const POST = createHandler(async (req) => {
  checkRateLimit(req, 'auth');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Request body debe ser JSON valido', 400);
  }

  const result = loginSchema.safeParse(body);
  if (!result.success) {
    throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);
  }

  const { email, password } = result.data;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData.session) {
    throw new ApiError('INVALID_CREDENTIALS', 'Email o password incorrectos', 401);
  }

  const userId = authData.user.id;
  const admin = getAdminClient();

  // Get user's companies
  const { data: memberships, error: memberError } = await admin
    .from('user_companies')
    .select(`
      company_id,
      role,
      is_active,
      status,
      companies:company_id (id, name, rfc, onboarding_completed)
    `)
    .eq('user_id', userId)
    .in('status', ['active', 'invited']);

  if (memberError || !memberships || memberships.length === 0) {
    throw new ApiError('NO_COMPANIES', 'Usuario sin empresas asignadas', 403);
  }

  const activeCompany = memberships.find(m => m.is_active);
  const company = activeCompany?.companies || (memberships[0] as Record<string, unknown>).companies;

  return Response.json({
    data: {
      user: {
        id: userId,
        email: authData.user.email,
        full_name: authData.user.user_metadata?.full_name || '',
      },
      companies: memberships.map((m: Record<string, unknown>) => ({
        ...(m.companies as Record<string, unknown> || {}),
        role: m.role,
        is_active: m.is_active,
      })),
      active_company: company,
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
    },
  });
}, { rateLimit: 'auth', public: true });
