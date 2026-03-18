import { createHandler } from '@/lib/middleware/route-handler';
import { clearAuthCookies, extractAccessToken, withCookies } from '@/lib/auth-cookies';
import { getAdminClient } from '@/lib/supabase/admin';

export const POST = createHandler(async (req) => {
  // Invalidate the session server-side before clearing cookies
  try {
    const accessToken = extractAccessToken(req);
    if (accessToken) {
      const admin = getAdminClient();
      const { data: { user } } = await admin.auth.getUser(accessToken);
      if (user) {
        await admin.auth.admin.signOut(user.id);
      }
    }
  } catch {
    // Best effort — clear cookies regardless
  }

  const cookies = clearAuthCookies();
  return withCookies(Response.json({ ok: true }), cookies);
}, { rateLimit: 'auth', public: true });
