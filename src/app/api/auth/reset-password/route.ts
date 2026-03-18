import { createClient } from '@supabase/supabase-js';
import { createHandler } from '@/lib/middleware/route-handler';
import { ApiError } from '@/lib/utils/errors';
import { checkRateLimit } from '@/lib/middleware/rate-limit';
import { z } from 'zod';

const resetSchema = z.object({
  email: z.string().email(),
});

export const POST = createHandler(async (req) => {
  checkRateLimit(req, 'auth');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Request body debe ser JSON valido', 400);
  }

  const result = resetSchema.safeParse(body);
  if (!result.success) {
    throw new ApiError('VALIDATION_ERROR', 'Email invalido', 400);
  }

  const { email } = result.data;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new ApiError('INTERNAL_ERROR', 'Supabase no configurado', 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Always return success to prevent email enumeration
  // Supabase sends email with link → /auth/callback?code=...&type=recovery
  await admin.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || ''}/auth/callback?type=recovery`,
  });

  return Response.json({
    message: 'Si el email existe, recibiras un link de recuperacion',
  });
}, { rateLimit: 'auth', public: true });
