import { createClient } from '@supabase/supabase-js';
import { createHandler } from '@/lib/middleware/route-handler';
import { ApiError } from '@/lib/utils/errors';

export const POST = createHandler(async (req) => {
  let body: { refresh_token?: string };
  try {
    body = await req.json();
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Request body debe ser JSON valido', 400);
  }

  const refreshToken = body.refresh_token;
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

  return Response.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  });
}, { public: true });
