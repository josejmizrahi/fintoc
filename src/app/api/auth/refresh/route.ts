import { createClient } from '@supabase/supabase-js';
import { createHandler } from '@/lib/middleware/route-handler';
import { ApiError } from '@/lib/utils/errors';
import { extractRefreshToken, setAuthCookies, withCookies } from '@/lib/auth-cookies';

export const POST = createHandler(async (req) => {
  // Read refresh token from httpOnly cookie (primary) or body (backward compat)
  let refreshToken = extractRefreshToken(req);

  if (!refreshToken) {
    try {
      const body = await req.json();
      refreshToken = body.refresh_token ?? null;
    } catch {
      // no body
    }
  }

  if (!refreshToken) {
    throw new ApiError('VALIDATION_ERROR', 'refresh_token es requerido', 400);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });

  if (error || !data.session) {
    throw new ApiError('TOKEN_EXPIRED', 'No se pudo renovar la sesion. Inicia sesion de nuevo.', 401);
  }

  // Set new tokens in httpOnly cookies
  const cookies = setAuthCookies(
    data.session.access_token,
    data.session.refresh_token,
  );

  return withCookies(
    Response.json({ expires_at: data.session.expires_at }),
    cookies,
  );
}, { public: true });
