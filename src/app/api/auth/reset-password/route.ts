import { createClient } from '@supabase/supabase-js';
import { createHandler } from '@/lib/middleware/route-handler';
import { ApiError } from '@/lib/utils/errors';
import { z } from 'zod';

const resetSchema = z.object({
  email: z.string().email(),
});

export const POST = createHandler(async (req) => {
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fintoc.vercel.app';

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Always return success to prevent email enumeration
  try {
    await admin.auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl}/auth/callback`,
    });
  } catch (err) {
    console.error('[reset-password] Supabase error:', err);
    // Still return success to prevent email enumeration
  }

  return Response.json({
    message: 'Si el email existe, recibiras un link de recuperacion',
  });
}, { public: true });
