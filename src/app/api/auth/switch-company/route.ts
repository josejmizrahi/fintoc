import { createClient } from '@supabase/supabase-js';
import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { switchCompanySchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';
import { extractRefreshToken, setAuthCookies, withCookies } from '@/lib/auth-cookies';

export const POST = createHandler(async (req) => {
  return withAuth(async (_req, ctx) => {
    let body: unknown;
    try {
      body = await _req.json();
    } catch {
      throw new ApiError('VALIDATION_ERROR', 'Request body debe ser JSON valido', 400);
    }

    const result = switchCompanySchema.safeParse(body);
    if (!result.success) {
      throw new ApiError('VALIDATION_ERROR', 'company_id invalido', 400);
    }

    const { company_id } = result.data;
    const admin = getAdminClient();

    // Verify user belongs to this company
    const { data: membership } = await admin
      .from('user_companies')
      .select('id, role')
      .eq('user_id', ctx.user_id)
      .eq('company_id', company_id)
      .eq('status', 'active')
      .single();

    if (!membership) {
      throw new ApiError('NOT_MEMBER', 'No eres miembro de esta empresa', 403);
    }

    // Deactivate current active company
    const { error: deactivateError } = await admin
      .from('user_companies')
      .update({ is_active: false })
      .eq('user_id', ctx.user_id)
      .eq('is_active', true);

    if (deactivateError) {
      throw new ApiError('INTERNAL_ERROR', 'Error al desactivar empresa actual', 500);
    }

    // Activate new company
    const { error: activateError } = await admin
      .from('user_companies')
      .update({ is_active: true })
      .eq('user_id', ctx.user_id)
      .eq('company_id', company_id);

    if (activateError) {
      // Rollback: re-activate the previous company using the specific membership
      await admin.from('user_companies').update({ is_active: true })
        .eq('user_id', ctx.user_id)
        .eq('company_id', ctx.company_id)
        .eq('status', 'active');
      throw new ApiError('INTERNAL_ERROR', 'Error al activar nueva empresa', 500);
    }

    // Get company details
    const { data: company } = await admin
      .from('companies')
      .select('id, name, rfc, onboarding_completed')
      .eq('id', company_id)
      .single();

    if (!company) {
      // Rollback: re-activate the previous company
      await admin.from('user_companies').update({ is_active: false })
        .eq('user_id', ctx.user_id).eq('company_id', company_id);
      await admin.from('user_companies').update({ is_active: true })
        .eq('user_id', ctx.user_id).eq('company_id', ctx.company_id).eq('status', 'active');
      throw new ApiError('NOT_FOUND', 'Empresa no encontrada', 404);
    }

    // Force a token refresh so the JWT gets the new active_company_id claim
    let cookies: string[] = [];

    // Read refresh token from httpOnly cookie (primary) or legacy header
    const refreshToken = extractRefreshToken(_req) || _req.headers.get('x-refresh-token');

    if (refreshToken) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: session } = await supabase.auth.refreshSession({
        refresh_token: refreshToken,
      });

      if (session?.session) {
        cookies = setAuthCookies(
          session.session.access_token,
          session.session.refresh_token,
        );
      }
    }

    const response = Response.json({
      data: {
        active_company: { ...company, role: membership.role },
      },
    });

    return cookies.length > 0 ? withCookies(response, cookies) : response;
  })(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
