/**
 * Auth Package — simplified tenant resolution
 *
 * Resolves active company server-side from user_companies table.
 * No JWT claims needed — always fresh, no stale tokens.
 */
import { getAdminClient } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/utils/errors';

export interface AuthContext {
  userId: string;
  companyId: string;
  role: string;
  email: string;
}

/**
 * Resolve the active tenant for a user.
 * Reads directly from user_companies — always fresh, no JWT stale issues.
 */
export async function resolveTenant(userId: string): Promise<{
  companyId: string;
  role: string;
}> {
  const admin = getAdminClient();
  const { data: membership, error } = await admin
    .from('user_companies')
    .select('company_id, role')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('status', 'active')
    .single();

  if (error || !membership) {
    throw new ApiError('NO_COMPANIES', 'Usuario sin empresa activa', 403);
  }

  return {
    companyId: membership.company_id,
    role: membership.role,
  };
}

/**
 * Switch active company — just an UPDATE, no token refresh needed.
 */
export async function switchCompany(userId: string, newCompanyId: string): Promise<void> {
  const admin = getAdminClient();

  // Verify user has access to the target company
  const { data: target } = await admin
    .from('user_companies')
    .select('id')
    .eq('user_id', userId)
    .eq('company_id', newCompanyId)
    .eq('status', 'active')
    .single();

  if (!target) {
    throw new ApiError('NOT_MEMBER', 'Usuario no es miembro de esta empresa', 403);
  }

  // Deactivate all, then activate the target
  await admin
    .from('user_companies')
    .update({ is_active: false })
    .eq('user_id', userId);

  await admin
    .from('user_companies')
    .update({ is_active: true })
    .eq('user_id', userId)
    .eq('company_id', newCompanyId);
}

/**
 * Extract and validate token from request, resolve full auth context.
 */
export async function authenticateRequest(req: Request): Promise<AuthContext> {
  const token = extractToken(req);
  if (!token) {
    throw new ApiError('UNAUTHORIZED', 'Token de autenticación requerido', 401);
  }

  const admin = getAdminClient();
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);

  if (error || !user) {
    throw new ApiError('TOKEN_EXPIRED', 'Token inválido o expirado', 401);
  }

  const tenant = await resolveTenant(user.id);

  return {
    userId: user.id,
    companyId: tenant.companyId,
    role: tenant.role,
    email: user.email || '',
  };
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

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
