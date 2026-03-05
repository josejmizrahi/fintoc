import { createClient } from '@/lib/supabase/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/utils/errors';

export interface AuthContext {
  user_id: string;
  company_id: string | number;
  role: string;
  email: string;
  supabase: ReturnType<typeof createClient>;
}

type AuthHandler = (req: Request, ctx: AuthContext) => Promise<Response>;

function extractToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // Try cookie
  const cookies = req.headers.get('cookie');
  if (cookies) {
    const match = cookies.match(/sb-[^=]+-auth-token=([^;]+)/);
    if (match) {
      try {
        const parsed = JSON.parse(decodeURIComponent(match[1]));
        return Array.isArray(parsed) ? parsed[0] : parsed;
      } catch {
        return match[1];
      }
    }
  }
  return null;
}

export function withAuth(handler: AuthHandler) {
  return async (req: Request, params?: Record<string, unknown>): Promise<Response> => {
    const token = extractToken(req);
    if (!token) {
      throw new ApiError('UNAUTHORIZED', 'Token de autenticacion requerido', 401);
    }

    // Use admin client (service role key) for token validation and user_companies lookup.
    // This bypasses RLS, which is safe since all route handlers already use getAdminClient().
    // The middleware has already validated the token, but we need the user object here.
    const admin = getAdminClient();
    const { data: { user }, error } = await admin.auth.getUser(token);

    if (error || !user) {
      throw new ApiError('TOKEN_EXPIRED', 'Token invalido o expirado', 401);
    }

    // Get active company membership (admin client bypasses RLS)
    const { data: membership, error: memberError } = await admin
      .from('user_companies')
      .select('company_id, role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .eq('status', 'active')
      .single();

    if (memberError || !membership) {
      throw new ApiError('NO_COMPANIES', 'Usuario sin empresa activa', 403);
    }

    // Create a user-scoped client for route handlers that need RLS context
    const supabase = createClient(token);

    const ctx: AuthContext = {
      user_id: user.id,
      company_id: membership.company_id,
      role: membership.role,
      email: user.email || '',
      supabase,
    };

    // Merge params into request if present
    if (params) {
      Object.assign(ctx, { params });
    }

    return handler(req, ctx);
  };
}
