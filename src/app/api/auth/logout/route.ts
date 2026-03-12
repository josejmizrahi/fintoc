import { createHandler } from '@/lib/middleware/route-handler';
import { clearAuthCookies, withCookies } from '@/lib/auth-cookies';

export const POST = createHandler(async () => {
  const cookies = clearAuthCookies();
  return withCookies(Response.json({ ok: true }), cookies);
}, { rateLimit: 'auth', public: true });
