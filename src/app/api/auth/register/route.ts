import { createHandler } from '@/lib/middleware/route-handler';
import { getAdminClient } from '@/lib/supabase/admin';
import { registerSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { checkRateLimit } from '@/lib/middleware/rate-limit';

export const POST = createHandler(async (req) => {
  checkRateLimit(req, 'auth');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Request body debe ser JSON valido', 400);
  }

  const result = registerSchema.safeParse(body);
  if (!result.success) {
    throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400, {
      fields: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  const { email, password, full_name, company_name, rfc } = result.data;
  const admin = getAdminClient();

  // Check if RFC already exists
  const { data: existingCompany } = await admin
    .from('companies')
    .select('id')
    .eq('rfc', rfc.toUpperCase())
    .single();

  if (existingCompany) {
    throw new ApiError('COMPANY_RFC_EXISTS', 'RFC de empresa ya existe', 409);
  }

  // Create user in Supabase Auth
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name || '' },
  });

  if (authError) {
    if (authError.message.includes('already') || authError.message.includes('exists')) {
      throw new ApiError('EMAIL_ALREADY_EXISTS', 'Email ya registrado', 409);
    }
    throw new ApiError('INTERNAL_ERROR', 'Error al crear usuario', 500);
  }

  const userId = authData.user.id;

  // Create company
  const { data: company, error: companyError } = await admin
    .from('companies')
    .insert({
      name: company_name,
      rfc: rfc.toUpperCase(),
      onboarding_completed: false,
    })
    .select()
    .single();

  if (companyError) {
    // Cleanup: delete the auth user
    await admin.auth.admin.deleteUser(userId);
    throw new ApiError('INTERNAL_ERROR', 'Error al crear empresa', 500);
  }

  // Create user_companies membership
  const { error: memberError } = await admin.from('user_companies').insert({
    user_id: userId,
    company_id: company.id,
    role: 'admin',
    is_active: true,
    status: 'active',
  });

  if (memberError) {
    console.error('user_companies insert failed:', JSON.stringify(memberError));
    await admin.auth.admin.deleteUser(userId);
    await admin.from('companies').delete().eq('id', company.id);
    throw new ApiError('INTERNAL_ERROR', `Error al crear membresia: ${memberError.message}`, 500);
  }

  // Generate a session for the user
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const { createClient } = await import('@supabase/supabase-js');
  const anonClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: session } = await anonClient.auth.signInWithPassword({ email, password });

  return Response.json({
    user: {
      id: userId,
      email,
      full_name: full_name || '',
    },
    company: {
      id: company.id,
      name: company.name,
      rfc: company.rfc,
    },
    tenant: {
      id: company.id,
      name: company.name,
      rfc: company.rfc,
    },
    role: 'admin',
    onboarding_completed: false,
    access_token: session?.session?.access_token || null,
    refresh_token: session?.session?.refresh_token || null,
  }, { status: 201 });
}, { rateLimit: 'auth', public: true });
