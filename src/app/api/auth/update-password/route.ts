import { createClient } from '@supabase/supabase-js';
import { createHandler } from '@/lib/middleware/route-handler';
import { ApiError } from '@/lib/utils/errors';
import { extractAccessToken, setAuthCookies, withCookies } from '@/lib/auth-cookies';
import { z } from 'zod';

const updatePasswordSchema = z.object({
  password: z.string()
    .min(8, 'Minimo 8 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos 1 mayuscula')
    .regex(/\d/, 'Debe contener al menos 1 numero'),
});

export const POST = createHandler(async (req) => {
  let body: unknown;
  try { body = await req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

  const result = updatePasswordSchema.safeParse(body);
  if (!result.success) {
    throw new ApiError('VALIDATION_ERROR', result.error.issues[0]?.message || 'Contrasena invalida', 400);
  }

  const { password } = result.data;

  // Get the access token from httpOnly cookie (set by auth/callback after recovery)
  const accessToken = extractAccessToken(req);
  if (!accessToken) {
    throw new ApiError('UNAUTHORIZED', 'Sesion no valida. Solicita un nuevo link de recuperacion.', 401);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  // Set the session from the access token
  const { error: sessionError } = await supabase.auth.getUser(accessToken);
  if (sessionError) {
    throw new ApiError('UNAUTHORIZED', 'Token expirado. Solicita un nuevo link de recuperacion.', 401);
  }

  // Update the password
  const { data: updateData, error: updateError } = await supabase.auth.updateUser({ password });

  if (updateError) {
    if (updateError.message.includes('same')) {
      throw new ApiError('VALIDATION_ERROR', 'La nueva contrasena debe ser diferente a la actual', 400);
    }
    throw new ApiError('INTERNAL_ERROR', `Error al actualizar contrasena: ${updateError.message}`, 500);
  }

  // Refresh session with new credentials
  let cookies: string[] = [];
  if (updateData.user) {
    const { data: session } = await supabase.auth.refreshSession();
    if (session?.session) {
      cookies = setAuthCookies(session.session.access_token, session.session.refresh_token);
    }
  }

  const response = Response.json({
    message: 'Contrasena actualizada correctamente',
  });

  return cookies.length > 0 ? withCookies(response, cookies) : response;
}, { rateLimit: 'auth', public: true });
