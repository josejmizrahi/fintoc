import { createClient } from '@supabase/supabase-js';
import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { switchCompanySchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';

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
    await admin
      .from('user_companies')
      .update({ is_active: false })
      .eq('user_id', ctx.user_id)
      .eq('is_active', true);

    // Activate new company
    await admin
      .from('user_companies')
      .update({ is_active: true })
      .eq('user_id', ctx.user_id)
      .eq('company_id', company_id);

    // Get company details
    const { data: company } = await admin
      .from('companies')
      .select('id, name, rfc, onboarding_completed')
      .eq('id', company_id)
      .single();

    // Force a token refresh so the JWT gets the new active_company_id claim
    let newAccessToken: string | null = null;
    let newRefreshToken: string | null = null;

    const refreshToken = _req.headers.get('x-refresh-token');
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
        newAccessToken = session.session.access_token;
        newRefreshToken = session.session.refresh_token;
      }
    }

    return Response.json({
      data: {
        active_company: { ...company, role: membership.role },
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
      },
    });
  })(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
